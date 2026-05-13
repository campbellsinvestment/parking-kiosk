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
      this.message = "Kiosk is out of service. Please pay inside.";
      this.detail = "Fail-safe: gate would raise on real hardware.";
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
    this.message = "Welcome. Touch a button on this display.";
    this.detail =
      this.kioskStatus === KIOSK_STATUS.LIMITED
        ? "Limited mode: payments may route inside if the gateway stays offline."
        : "";
    this._emit();
  }

  /** After free exit / offline payment / decline limit — patron taps Done on display. */
  acknowledgeExit() {
    if (this.flow !== FLOW.EXIT_DONE) return;
    this.flow = FLOW.IDLE;
    this.message = "Welcome. Touch a button on this display.";
    this.detail =
      this.kioskStatus === KIOSK_STATUS.LIMITED
        ? "Limited mode: payments may route inside if the gateway stays offline."
        : "";
    this._emit();
  }

  /** Section 2 — entry button. */
  async pressEntryButton() {
    if (this.kioskStatus === KIOSK_STATUS.OUT_OF_SERVICE) {
      this.message = "Kiosk is out of service.";
      this._emit();
      return null;
    }
    if (!this.ticketPaperOk) {
      this._err("ERR-001", "Printer unavailable");
      this.message = "Paper unavailable. Please proceed inside to pay.";
      this.detail = "Gate raised (simulated).";
      this.gateOpen = true;
      this.gateMode = "entry";
      this._emit();
      return null;
    }

    this.flow = FLOW.ENTRY_PRINTING;
    this.message = "Printing your ticket…";
    this.detail = "";
    this._emit();
    await delay(900);

    const id = uuid();
    const entryMs = Date.now();
    this.tickets.set(id, { id, entryMs, status: "ACTIVE" });
    const qr = encodeQrPayload(id, entryMs);

    const printFails = Math.random() < 0.008; // rare demo fault
    if (printFails) {
      this._err("ERR-001", "Print failed");
      this.tickets.get(id).status = "VOID";
      this.message = "Paper unavailable. Please proceed inside to pay.";
      this.gateOpen = true;
      this.gateMode = "entry";
      this.flow = FLOW.IDLE;
      this._emit();
      return null;
    }

    this.lastIssuedQr = qr;
    this.flow = FLOW.ENTRY_GATE_OPEN;
    this.message = "Welcome. Please take your ticket.";
    this.detail = "Gate opening. Remove ticket from slot.";
    this.gateOpen = true;
    this.gateMode = "entry";
    this._emit();

    await delay(2200);
    this.gateOpen = false;
    this.gateMode = "closed";
    this.flow = FLOW.IDLE;
    this.message = "Entry complete. Have a good visit.";
    this.detail = "";
    this._emit();
    return { ticketId: id, qr };
  }

  /** Begin exit: prompt for scan (Section 3). */
  beginExit() {
    if (this.kioskStatus === KIOSK_STATUS.OUT_OF_SERVICE) {
      this.message = "Kiosk is out of service.";
      this._emit();
      return;
    }
    this.flow = FLOW.EXIT_SCAN;
    this.currentTicketId = null;
    this.exitBreakdown = null;
    this.paymentRetries = 0;
    this.message = "Please scan your ticket.";
    this.detail = "Hold ticket to the reader, then touch SCAN on this display.";
    this._emit();
  }

  /** Simulated QR reader: uses last issued ticket, else newest active ticket. */
  scanFromReader() {
    if (this.flow !== FLOW.EXIT_SCAN) {
      this.message = "Touch EXIT on the home screen first.";
      this._emit();
      return false;
    }
    const raw = this.lastIssuedQr || this._latestActiveQrPayload();
    if (!raw) {
      this.message = "No ticket found. Take a ticket at entry first.";
      this._emit();
      return false;
    }
    return this.scanTicket(raw);
  }

  /** Leave exit scan step without scanning. */
  cancelExitFlow() {
    if (this.flow !== FLOW.EXIT_SCAN) return;
    this.flow = FLOW.IDLE;
    this.message = "Welcome. Touch a button on this display.";
    this.detail =
      this.kioskStatus === KIOSK_STATUS.LIMITED
        ? "Limited mode: payments may route inside if the gateway stays offline."
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
      this.message = "Start exit flow first.";
      this._emit();
      return false;
    }
    let ticketId;
    let entryMs;
    try {
      ({ ticketId, entryMs } = decodeQrPayload(qrRaw.trim()));
    } catch {
      this._err("ERR-003", "Invalid QR");
      this.message = "Invalid ticket. Please see staff at the booth.";
      this.detail = "";
      this.gateOpen = false;
      this._emit();
      return false;
    }

    const ticket = this.tickets.get(ticketId);
    if (!ticket) {
      this._err("ERR-003", "Ticket not in database");
      this.message = "Invalid ticket. Please see staff at the booth.";
      this._emit();
      return false;
    }
    if (ticket.status === "PAID") {
      this.message = "This ticket has already been paid.";
      this.detail = "";
      this._emit();
      return false;
    }
    if (ticket.status === "VOID") {
      this._err("ERR-003", "Void ticket");
      this.message = "Invalid ticket. Please see staff at the booth.";
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
      this.message = "No charge. Have a good day.";
      this.detail = `Parked ${minutes} min (free period).`;
      ticket.status = "PAID";
      this.gateOpen = true;
      this.gateMode = "exit";
      this.flow = FLOW.EXIT_DONE;
      this._emit();
      return true;
    }

    if (!this.paymentGatewayOnline) {
      this._err("ERR-005", "Payment gateway offline");
      this.message = "Payment system offline. Gate is open. Please pay inside.";
      this.detail = "";
      ticket.status = "PAID";
      this.gateOpen = true;
      this.gateMode = "exit";
      this.flow = FLOW.EXIT_DONE;
      this._emit();
      return true;
    }

    this.message = "Amount due";
    this.detail = `Duration: ${minutes} min\nBase: $${base.toFixed(2)}\nHST (13%): $${tax.toFixed(2)}\nTotal: $${total.toFixed(2)}`;
    this.flow = FLOW.EXIT_PAYMENT;
    this._emit();
    return true;
  }

  /**
   * Section 4 — pay with card (simulated gateway).
   * @param {{ approve?: boolean }} opts approve false simulates decline
   */
  async pay(opts = {}) {
    if (this.flow !== FLOW.EXIT_PAYMENT || !this.currentTicketId || !this.exitBreakdown) {
      this.message = "Nothing to pay right now.";
      this._emit();
      return;
    }
    const ticket = this.tickets.get(this.currentTicketId);
    const approve = opts.approve !== false;

    if (!this.paymentGatewayOnline) {
      this._err("ERR-005", "Gateway offline during payment");
      this.message = "Connection issue. Please try again or proceed inside.";
      this.gateOpen = true;
      this.gateMode = "exit";
      this._emit();
      return;
    }

    await delay(600);
    const timeout = Math.random() < 0.05;
    if (timeout) {
      this._err("ERR-005", "No response within timeout");
      this.message = "Connection issue. Please try again or proceed inside.";
      this.gateOpen = true;
      this.gateMode = "exit";
      this._emit();
      return;
    }

    if (!approve) {
      this.paymentRetries += 1;
      this._err("ERR-004", "Card declined");
      if (this.paymentRetries < 3) {
        this.message = "Payment declined. Please try a different card.";
        this._emit();
        return;
      }
      this.message = "Payment declined. Please proceed inside to pay at the booth.";
      this.detail = "";
      this.gateOpen = true;
      this.gateMode = "exit";
      this.flow = FLOW.EXIT_DONE;
      this._emit();
      return;
    }

    ticket.status = "PAID";
    this.message = "Payment approved. Thank you.";
    if (!this.receiptPaperOk) {
      this._err("ERR-006", "Receipt printer unavailable");
      this.detail = "Payment accepted. Receipt unavailable. Thank you.";
    } else {
      this.detail = "Receipt printed (simulated).";
    }
    this.gateOpen = true;
    this.gateMode = "exit";
    this.flow = FLOW.EXIT_DONE;
    this._emit();
    await delay(2000);
    this.gateOpen = false;
    this.gateMode = "closed";
    this.flow = FLOW.IDLE;
    this.message = "Thank you. Drive safely.";
    this.detail = "";
    this._emit();
  }

  /** Section 5 — critical fault demo. */
  triggerCriticalFault() {
    this._err("ERR-007", "Critical hardware fault (simulated)");
    this.kioskStatus = KIOSK_STATUS.OUT_OF_SERVICE;
    this.message = "Kiosk is out of service. Please pay inside.";
    this.detail = "Gate held open until staff reset.";
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
    this.startup();
  }

  /** Demo toggles */
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
