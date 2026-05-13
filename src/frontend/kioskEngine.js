/**
 * In-browser kiosk logic aligned with docs/pseudocode.txt and README rate schedule.
 * No network: tickets and transactions live in memory for demonstration.
 */

const TAX_RATE = 0.13; // Ontario HST default per README

function uuid() {
  return crypto.randomUUID();
}

/** Duration in whole minutes, rounded up (PKS-PSEUDO-001 §3). */
export function parkingMinutes(entryMs, exitMs) {
  const diff = Math.max(0, exitMs - entryMs);
  return Math.ceil(diff / 60_000);
}

/** Base parking fee in dollars before tax. */
export function baseFeeFromMinutes(durationMinutes) {
  const d = Math.max(0, durationMinutes);
  if (d <= 30) return 0;
  if (d <= 60) return 2;
  if (d <= 120) return 4;
  const additionalHours = Math.ceil((d - 120) / 60);
  return 4 + additionalHours * 2;
}

function encodeQrPayload(ticketId, entryMs) {
  return JSON.stringify({ v: 1, id: ticketId, t: entryMs });
}

export function decodeQrPayload(raw) {
  const data = JSON.parse(raw);
  if (data?.v !== 1 || !data.id || typeof data.t !== "number") {
    throw new Error("INVALID_QR");
  }
  return { ticketId: data.id, entryMs: data.t };
}

const KIOSK_STATUS = {
  OUT_OF_SERVICE: "OUT_OF_SERVICE",
  LIMITED: "LIMITED",
  READY: "READY",
};

const FLOW = {
  IDLE: "IDLE",
  ENTRY_PRINTING: "ENTRY_PRINTING",
  ENTRY_GATE_OPEN: "ENTRY_GATE_OPEN",
  EXIT_SCAN: "EXIT_SCAN",
  EXIT_SUMMARY: "EXIT_SUMMARY",
  EXIT_PAYMENT: "EXIT_PAYMENT",
  EXIT_DONE: "EXIT_DONE",
};

/** Physical stalls in the 3D lot (two rows × stallCount); matches main.js layout. */
export const LOT_CAPACITY = 10;

export class KioskEngine {
  constructor(onChange) {
    this._notify = typeof onChange === "function" ? onChange : () => {};
    this.dbOnline = true;
    this.paymentGatewayOnline = true;
    this.ticketPaperOk = true;
    this.receiptPaperOk = true;
    this.kioskStatus = KIOSK_STATUS.READY;
    this.flow = FLOW.IDLE;
    this.message = "";
    this.detail = "";
    this.lastErrorCode = null;
    this.log = [];
    /** @type {Map<string, { id: string, entryMs: number, status: 'ACTIVE'|'PAID'|'VOID' }>} */
    this.tickets = new Map();
    this.currentTicketId = null;
    this.exitBreakdown = null;
    this.paymentRetries = 0;
    this.gateOpen = false;
    this.gateMode = "closed"; // 'closed' | 'entry' | 'exit'
    /** Last successfully issued ticket QR JSON (for on-kiosk “scanner” demo). */
    this.lastIssuedQr = null;
    /** Parked vehicles in the fenced lot (NPC stalls + patron when parked). */
    this.occupiedSpaces = 9;
    /** Patron vehicle is parked and counts toward capacity. */
    this.playerParkedInLot = false;
    /** Last completed payment method for UI / 3D props ('card' | 'cash'). */
    this.lastPaymentMethod = null;
    /** When true, ticket print and card gateway may randomly fail (for QA). Off by default; use Service, Random faults. */
    this.simulateRandomFaults = false;
  }

  get snapshot() {
    return {
      kioskStatus: this.kioskStatus,
      flow: this.flow,
      message: this.message,
      detail: this.detail,
      lastErrorCode: this.lastErrorCode,
      gateOpen: this.gateOpen,
      gateMode: this.gateMode,
      paymentGatewayOnline: this.paymentGatewayOnline,
      ticketPaperOk: this.ticketPaperOk,
      receiptPaperOk: this.receiptPaperOk,
      dbOnline: this.dbOnline,
      currentTicketId: this.currentTicketId,
      exitBreakdown: this.exitBreakdown,
      paymentRetries: this.paymentRetries,
      log: [...this.log],
      occupiedSpaces: this.occupiedSpaces,
      lotCapacity: LOT_CAPACITY,
      playerParkedInLot: this.playerParkedInLot,
      lastPaymentMethod: this.lastPaymentMethod,
      simulateRandomFaults: this.simulateRandomFaults,
    };
  }

  _emit() {
    this._notify(this.snapshot);
  }

  _err(code, description) {
    this.lastErrorCode = code;
    const line = `${new Date().toISOString()} ${code} ${description}`;
    this.log.unshift(line);
    if (this.log.length > 40) this.log.length = 40;
  }

  /** Section 1 — startup (simplified checks). */
  startup() {
    this.lastErrorCode = null;
    if (!this.dbOnline) {
      this._err("ERR-008", "Database unreachable");
      this.kioskStatus = KIOSK_STATUS.OUT_OF_SERVICE;
      this.message = "OFFLINE";
      this.detail = "PAY INSIDE.";
      this.gateOpen = true;
      this.gateMode = "exit";
      this._emit();
      return;
    }
    if (!this.paymentGatewayOnline) {
      this._err("ERR-005", "Payment gateway unreachable at startup");
      this.kioskStatus = KIOSK_STATUS.LIMITED;
    } else {
      this.kioskStatus = KIOSK_STATUS.READY;
    }
    if (!this.ticketPaperOk) {
      this._err("ERR-001", "Ticket paper empty");
    }
    if (!this.receiptPaperOk) {
      this._err("ERR-006", "Receipt paper empty");
    }
    this.gateOpen = false;
    this.gateMode = "closed";
    this.flow = FLOW.IDLE;
    this.message = "READY";
    this.detail =
      this.kioskStatus === KIOSK_STATUS.LIMITED
        ? "LIMITED MODE."
        : "";
    this.occupiedSpaces = 9;
    this.playerParkedInLot = false;
    this.lastPaymentMethod = null;
    this._emit();
  }

  /** After paid / free exit: flow stays EXIT_DONE until patron drives off-lot; then main.js calls this. */
  acknowledgeExit() {
    if (this.flow !== FLOW.EXIT_DONE) return;
    this.gateOpen = false;
    this.gateMode = "closed";
    this.flow = FLOW.IDLE;
    this.message = "READY";
    this.detail =
      this.kioskStatus === KIOSK_STATUS.LIMITED
        ? "LIMITED MODE."
        : "";
    if (this.playerParkedInLot) {
      this.playerParkedInLot = false;
      this.occupiedSpaces = Math.max(0, this.occupiedSpaces - 1);
    }
    this.lastPaymentMethod = null;
    this.lastIssuedQr = null;
    this.currentTicketId = null;
    this.exitBreakdown = null;
    this.paymentRetries = 0;
    this._emit();
  }

  /** Called from the 3D demo when the patron car finishes parking in the last free stall. */
  markPlayerParkedInLot() {
    if (this.playerParkedInLot) return;
    this.playerParkedInLot = true;
    if (this.occupiedSpaces < LOT_CAPACITY) this.occupiedSpaces += 1;
    this._emit();
  }

  /** Section 2 — entry button. */
  async pressEntryButton() {
    if (this.kioskStatus === KIOSK_STATUS.OUT_OF_SERVICE) {
      this.message = "OFFLINE";
      this._emit();
      return null;
    }
    if (this.occupiedSpaces >= LOT_CAPACITY) {
      this.message = "LOT FULL";
      this.detail = "";
      this._emit();
      return null;
    }
    if (!this.ticketPaperOk) {
      this._err("ERR-001", "Printer unavailable");
      this.message = "NO PAPER";
      this.detail = "BOOTH PAY.";
      this.gateOpen = true;
      this.gateMode = "entry";
      this._emit();
      return null;
    }

    this.flow = FLOW.ENTRY_PRINTING;
    this.message = "PRINTING...";
    this.detail = "";
    this._emit();
    await delay(900);

    const id = uuid();
    const entryMs = Date.now();
    this.tickets.set(id, { id, entryMs, status: "ACTIVE" });
    const qr = encodeQrPayload(id, entryMs);

    const printFails = this.simulateRandomFaults && Math.random() < 0.22;
    if (printFails) {
      this._err("ERR-001", "Print failed");
      this.tickets.get(id).status = "VOID";
      this.message = "NO PAPER";
      this.gateOpen = true;
      this.gateMode = "entry";
      this.flow = FLOW.IDLE;
      this._emit();
      return null;
    }

    this.lastIssuedQr = qr;
    this.flow = FLOW.ENTRY_GATE_OPEN;
    this.message = "PULL TICKET";
    this.detail = "";
    this.gateOpen = true;
    this.gateMode = "entry";
    this._emit();
    return { ticketId: id, qr };
  }

  /**
   * Patron confirms they took the slip (or acknowledges the issued ticket).
   * Gate stays open until the car reaches a stall; exit scan still uses `lastIssuedQr`.
   */
  patronTakeTicketFromSlot() {
    if (this.flow !== FLOW.ENTRY_GATE_OPEN) return false;
    this.message = "OK";
    this.detail = "";
    this._emit();
    return true;
  }

  /** After ticket pickup: gate stays open until the patron car reaches the stall (3D demo calls this). */
  patronFinishedEntryDrive() {
    if (this.flow !== FLOW.ENTRY_GATE_OPEN) return;
    this.gateOpen = false;
    this.gateMode = "closed";
    this.flow = FLOW.IDLE;
    this.message = "OK";
    this.detail = "";
    this._emit();
  }

  /** Begin exit: prompt for scan (Section 3). */
  beginExit() {
    if (this.kioskStatus === KIOSK_STATUS.OUT_OF_SERVICE) {
      this.message = "OFFLINE";
      this._emit();
      return;
    }
    this.flow = FLOW.EXIT_SCAN;
    this.currentTicketId = null;
    this.exitBreakdown = null;
    this.paymentRetries = 0;
    this.message = "SCAN";
    this.detail = "";
    this._emit();
  }

  /** Simulated QR reader: uses last issued ticket, else newest active ticket. */
  scanFromReader() {
    if (this.flow !== FLOW.EXIT_SCAN) {
      this.message = "EXIT FIRST";
      this._emit();
      return false;
    }
    const raw = this.lastIssuedQr || this._latestActiveQrPayload();
    if (!raw) {
      this.message = "NO TICKET";
      this._emit();
      return false;
    }
    return this.scanTicket(raw);
  }

  /** Leave exit scan step without scanning. */
  cancelExitFlow() {
    if (this.flow !== FLOW.EXIT_SCAN) return;
    this.flow = FLOW.IDLE;
    this.message = "READY";
    this.detail =
      this.kioskStatus === KIOSK_STATUS.LIMITED
        ? "LIMITED MODE."
        : "";
    this._emit();
  }

  _latestActiveQrPayload() {
    const act = this.listActiveTickets();
    if (!act.length) return null;
    act.sort((a, b) => b.entryMs - a.entryMs);
    const t = act[0];
    return encodeQrPayload(t.id, t.entryMs);
  }

  /** Patron scan / lookup (Section 3). */
  scanTicket(qrRaw) {
    this.lastErrorCode = null;
    if (this.flow !== FLOW.EXIT_SCAN) {
      this.message = "BAD FLOW";
      this._emit();
      return false;
    }
    let ticketId;
    let entryMs;
    try {
      ({ ticketId, entryMs } = decodeQrPayload(qrRaw.trim()));
    } catch {
      this._err("ERR-003", "Invalid QR");
      this.message = "BAD TICKET";
      this.detail = "";
      this.gateOpen = false;
      this._emit();
      return false;
    }

    const ticket = this.tickets.get(ticketId);
    if (!ticket) {
      this._err("ERR-003", "Ticket not in database");
      this.message = "BAD TICKET";
      this._emit();
      return false;
    }
    if (ticket.status === "PAID") {
      this.message = "PAID";
      this.detail = "";
      this._emit();
      return false;
    }
    if (ticket.status === "VOID") {
      this._err("ERR-003", "Void ticket");
      this.message = "BAD TICKET";
      this._emit();
      return false;
    }

    const exitMs = Date.now();
    const minutes = parkingMinutes(ticket.entryMs, exitMs);
    const base = baseFeeFromMinutes(minutes);
    const tax = Math.round(base * TAX_RATE * 100) / 100;
    const total = Math.round((base + tax) * 100) / 100;

    this.currentTicketId = ticketId;
    this.exitBreakdown = { minutes, base, tax, total, exitMs };
    this.flow = FLOW.EXIT_SUMMARY;

    if (total <= 0) {
      this.message = `${minutes} MIN`;
      this.detail = "NO FEE";
      ticket.status = "PAID";
      this.lastPaymentMethod = "cash";
      this.gateOpen = true;
      this.gateMode = "exit";
      this.flow = FLOW.EXIT_DONE;
      this._emit();
      return true;
    }

    if (!this.paymentGatewayOnline) {
      this._err("ERR-005", "Payment gateway offline");
      this.message = `${minutes} MIN`;
      this.detail = "BOOTH PAY.";
      ticket.status = "PAID";
      this.lastPaymentMethod = "cash";
      this.gateOpen = true;
      this.gateMode = "exit";
      this.flow = FLOW.EXIT_DONE;
      this._emit();
      return true;
    }

    this.message = `${minutes} MIN`;
    this.detail = `DUE $${total.toFixed(2)}`;
    this.flow = FLOW.EXIT_PAYMENT;
    this._emit();
    return true;
  }

  /**
   * Section 4 — pay with card (simulated gateway) or cash.
   * @param {{ approve?: boolean, method?: 'card' | 'cash' }} opts
   */
  async pay(opts = {}) {
    if (this.flow !== FLOW.EXIT_PAYMENT || !this.currentTicketId || !this.exitBreakdown) {
      this.message = "NO BILL";
      this._emit();
      return;
    }
    const ticket = this.tickets.get(this.currentTicketId);
    const method = opts.method === "cash" ? "cash" : "card";
    const approve = opts.approve !== false;

    const finishPaid = () => {
      const mins = this.exitBreakdown.minutes;
      ticket.status = "PAID";
      this.lastPaymentMethod = method;
      this.message = "THANKS";
      if (!this.receiptPaperOk) {
        if (this.simulateRandomFaults) this._err("ERR-006", "Receipt printer unavailable");
        this.detail = `${mins} MIN  NO RCPT.`;
      } else {
        this.detail = `${mins} MIN  TAKE RCPT.`;
      }
      this.gateOpen = true;
      this.gateMode = "exit";
      this.flow = FLOW.EXIT_DONE;
      this._emit();
    };

    if (method === "cash") {
      await delay(500);
      finishPaid();
      return;
    }

    if (!this.paymentGatewayOnline) {
      this._err("ERR-005", "Gateway offline during payment");
      this.message = "NO LINE";
      this.detail = `${this.exitBreakdown.minutes} MIN`;
      this.gateOpen = true;
      this.gateMode = "exit";
      this._emit();
      return;
    }

    await delay(600);
    const timeout = this.simulateRandomFaults && Math.random() < 0.12;
    if (timeout) {
      this._err("ERR-005", "No response within timeout");
      this.message = "NO LINE";
      this.detail = `${this.exitBreakdown.minutes} MIN`;
      this.gateOpen = true;
      this.gateMode = "exit";
      this._emit();
      return;
    }

    if (!approve) {
      this.paymentRetries += 1;
      this._err("ERR-004", "Card declined");
      if (this.paymentRetries < 3) {
        this.message = "RETRY CARD";
        this.detail = `${this.exitBreakdown.minutes} MIN`;
        this._emit();
        return;
      }
      this.message = "USE BOOTH";
      this.detail = `${this.exitBreakdown.minutes} MIN`;
      this.gateOpen = true;
      this.gateMode = "exit";
      this.flow = FLOW.EXIT_DONE;
      this._emit();
      return;
    }

    finishPaid();
  }

  /** Section 5 — critical fault demo. */
  triggerCriticalFault() {
    this._err("ERR-007", "Critical hardware fault (simulated)");
    this.kioskStatus = KIOSK_STATUS.OUT_OF_SERVICE;
    this.message = "OUT OF ORDER";
    this.detail = "CALL STAFF.";
    this.gateOpen = true;
    this.gateMode = "exit";
    this._emit();
  }

  resetAfterFault() {
    this.kioskStatus = KIOSK_STATUS.READY;
    this.paymentGatewayOnline = true;
    this.dbOnline = true;
    this.ticketPaperOk = true;
    this.receiptPaperOk = true;
    this.simulateRandomFaults = false;
    this.startup();
  }

  /** Demo toggles */
  setSimulateRandomFaults(v) {
    this.simulateRandomFaults = !!v;
    this._emit();
  }

  setDbOnline(v) {
    this.dbOnline = v;
    this._emit();
  }
  setPaymentGatewayOnline(v) {
    this.paymentGatewayOnline = v;
    this._emit();
  }
  setTicketPaperOk(v) {
    this.ticketPaperOk = v;
    this._emit();
  }
  setReceiptPaperOk(v) {
    this.receiptPaperOk = v;
    this._emit();
  }

  listActiveTickets() {
    return [...this.tickets.values()].filter((t) => t.status === "ACTIVE");
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
