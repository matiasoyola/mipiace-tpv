// BookingEngine + estrategia por ReservationMode (ADR-K8 §4). B4 implementa
// SOLO `CitaMode`. `MesaMode` queda como interfaz no implementada — sin
// ramas muertas en el núcleo. El motor es agnóstico: lo específico de cita
// (staff con skill, recursos por tipo, encadenado secuencial) vive aquí; el
// núcleo (appointments/assignments/store/GiST) no se clava a "profesional".
//
// El anti-solape lo resuelve la BD (GiST) en `store.insertHold`. Este motor
// sólo calcula QUÉ huecos son factibles y CÓMO asignarlos; la carrera final
// la gana Postgres.

import { ExclusionError, type AgendaStore, type HoldInput } from "./store.js";
import {
  CENTER_TZ,
  SLOT_MINUTES,
  gridStarts,
  minutesToTime,
  overlaps,
  timeToMinutes,
  utcToWallDate,
  utcToWallTime,
  wallTimeToUtc,
} from "./time.js";
import type {
  AppointmentView,
  BlockInterval,
  Occupancy,
  PlannedAssignment,
  PlannedItem,
  RequestItem,
  ReservationSource,
  ServiceRequirement,
  Slot,
  TemplateSlot,
} from "./types.js";

export interface AvailabilityParams {
  tenantId: string;
  items: RequestItem[];
  // Fija el profesional para TODOS los items (slot-first). Opcional.
  staffUserId?: string | null;
  fromDate: string; // YYYY-MM-DD (hora local del centro)
  toDate: string; // YYYY-MM-DD
}

export interface HoldRequest {
  tenantId: string;
  externalId: string | null;
  clientId: string | null;
  items: RequestItem[];
  start: string; // ISO UTC del inicio del visit
  source: ReservationSource;
  // Presencial = confirmada directa (no hold con TTL).
  confirmed: boolean;
  pendingTtlMinutes: number;
  notes: string | null;
}

export type HoldResult =
  | { ok: true; appointment: AppointmentView; duplicate?: boolean }
  | { ok: false; reason: "NO_REQUIREMENTS" | "NO_SLOT" | "TAKEN"; alternatives: Slot[] };

// Interfaz del motor (idéntica firma que expondrá KoiboxAdapter/B6).
export interface BookingEngine {
  availability(params: AvailabilityParams): Promise<Slot[]>;
  hold(request: HoldRequest): Promise<HoldResult>;
  confirm(tenantId: string, id: string): Promise<AppointmentView | null>;
  cancel(tenantId: string, id: string): Promise<AppointmentView | null>;
  noShow(tenantId: string, id: string): Promise<AppointmentView | null>;
  setInService(tenantId: string, id: string): Promise<AppointmentView | null>;
  complete(tenantId: string, id: string): Promise<AppointmentView | null>;
  reschedule(
    tenantId: string,
    id: string,
    newStartISO: string,
  ): Promise<HoldResult | { ok: false; reason: "NOT_FOUND"; alternatives: [] }>;
}

// Datos precargados para resolver toda la ventana en memoria (coste trivial:
// ~44 slots/día × pocos profesionales).
interface EngineContext {
  requirements: Map<string, ServiceRequirement>;
  skilledByService: Map<string, Set<string>>;
  templateByUserDate: Map<string, TemplateSlot[]>; // key `${userId}|${date}`
  occByStaff: Map<string, Occupancy[]>;
  occByResource: Map<string, Occupancy[]>;
  blocks: BlockInterval[];
  resourcesByKind: Map<string, string[]>;
}

function tKey(userId: string, date: string): string {
  return `${userId}|${date}`;
}

export function createCitaEngine(store: AgendaStore): BookingEngine {
  // Deriva los items planificados (snapshot + offsets secuenciales) del
  // pedido. Devuelve null si algún servicio no es agendable (sin scheduling).
  function deriveItems(
    items: RequestItem[],
    reqMap: Map<string, ServiceRequirement>,
  ): PlannedItem[] | null {
    const planned: PlannedItem[] = [];
    let offset = 0;
    for (let i = 0; i < items.length; i++) {
      const req = reqMap.get(items[i]!.serviceId);
      if (!req) return null; // servicio sin fila service_scheduling → ignorado
      planned.push({
        serviceId: req.serviceId,
        durationMin: req.durationMin,
        bufferBeforeMin: req.bufferBeforeMin,
        bufferAfterMin: req.bufferAfterMin,
        staffRequired: req.staffRequired,
        sortOrder: i,
        startOffsetMin: offset,
      });
      offset += req.durationMin; // encadenado secuencial
    }
    return planned;
  }

  function visitSpanMin(planned: PlannedItem[]): number {
    let end = 0;
    for (const it of planned) {
      end = Math.max(end, it.startOffsetMin + it.durationMin);
    }
    return end;
  }

  async function loadContext(
    params: AvailabilityParams,
    reqMap: Map<string, ServiceRequirement>,
  ): Promise<EngineContext> {
    const serviceIds = [...new Set(params.items.map((i) => i.serviceId))];
    const skilledByService = new Map<string, Set<string>>();
    const allStaff = new Set<string>();
    for (const sid of serviceIds) {
      let staff = await store.getSkilledStaff(params.tenantId, sid);
      // slot-first: el profesional viene fijado.
      if (params.staffUserId) {
        staff = staff.filter((u) => u === params.staffUserId);
      }
      const set = new Set(staff);
      skilledByService.set(sid, set);
      for (const u of set) allStaff.add(u);
    }
    const templates = await store.getTemplateSlots(
      params.tenantId,
      [...allStaff],
      params.fromDate,
      params.toDate,
    );
    const templateByUserDate = new Map<string, TemplateSlot[]>();
    for (const t of templates) {
      const k = tKey(t.userId, t.date);
      const arr = templateByUserDate.get(k) ?? [];
      arr.push(t);
      templateByUserDate.set(k, arr);
    }
    // Ventana UTC amplia (borde local del rango + margen de un día).
    const from = wallTimeToUtc(params.fromDate, "00:00");
    const toEnd = new Date(
      wallTimeToUtc(params.toDate, "23:59").getTime() + 60 * 60 * 1000,
    );
    const [occ, blocks, resourcesByKind] = await Promise.all([
      store.getOccupancies(params.tenantId, from, toEnd),
      store.getBlocks(params.tenantId, from, toEnd),
      store.getResourcesByKind(params.tenantId),
    ]);
    const occByStaff = new Map<string, Occupancy[]>();
    const occByResource = new Map<string, Occupancy[]>();
    for (const o of occ) {
      if (o.staffUserId) {
        const arr = occByStaff.get(o.staffUserId) ?? [];
        arr.push(o);
        occByStaff.set(o.staffUserId, arr);
      }
      if (o.resourceId) {
        const arr = occByResource.get(o.resourceId) ?? [];
        arr.push(o);
        occByResource.set(o.resourceId, arr);
      }
    }
    return {
      requirements: reqMap,
      skilledByService,
      templateByUserDate,
      occByStaff,
      occByResource,
      blocks,
      resourcesByKind,
    };
  }

  // ¿La plantilla del profesional cubre el intervalo de pared [needStart,
  // needEnd) (minutos) ese día?
  function templateCovers(
    ctx: EngineContext,
    userId: string,
    date: string,
    needStartMin: number,
    needEndMin: number,
  ): boolean {
    const slots = ctx.templateByUserDate.get(tKey(userId, date));
    if (!slots) return false;
    return slots.some(
      (s) =>
        timeToMinutes(s.startTime) <= needStartMin &&
        timeToMinutes(s.endTime) >= needEndMin,
    );
  }

  function staffFree(
    ctx: EngineContext,
    userId: string,
    startsAt: Date,
    endsAt: Date,
  ): boolean {
    const occ = ctx.occByStaff.get(userId);
    if (occ) {
      for (const o of occ) {
        if (
          overlaps(
            startsAt.getTime(),
            endsAt.getTime(),
            o.startsAt.getTime(),
            o.endsAt.getTime(),
          )
        )
          return false;
      }
    }
    // Bloqueos que afectan al profesional (STAFF suyo) o al centro (CENTER).
    for (const b of ctx.blocks) {
      if (b.scope === "STAFF" && b.staffUserId !== userId) continue;
      if (b.scope === "RESOURCE") continue;
      if (b.scope === "TABLE") continue;
      if (
        overlaps(
          startsAt.getTime(),
          endsAt.getTime(),
          b.startsAt.getTime(),
          b.endsAt.getTime(),
        )
      )
        return false;
    }
    return true;
  }

  function resourceFree(
    ctx: EngineContext,
    resourceId: string,
    startsAt: Date,
    endsAt: Date,
  ): boolean {
    const occ = ctx.occByResource.get(resourceId);
    if (occ) {
      for (const o of occ) {
        if (
          overlaps(
            startsAt.getTime(),
            endsAt.getTime(),
            o.startsAt.getTime(),
            o.endsAt.getTime(),
          )
        )
          return false;
      }
    }
    for (const b of ctx.blocks) {
      if (b.scope === "RESOURCE" && b.resourceId !== resourceId) continue;
      if (b.scope === "STAFF") continue;
      if (b.scope === "TABLE") continue;
      if (
        overlaps(
          startsAt.getTime(),
          endsAt.getTime(),
          b.startsAt.getTime(),
          b.endsAt.getTime(),
        )
      )
        return false;
    }
    return true;
  }

  // Calcula una asignación concreta y factible para un inicio de visit dado.
  // Devuelve las filas planificadas o null si no cabe. `usedStaff` /
  // `usedResource` evitan que el mismo recurso sirva dos items solapados del
  // MISMO visit (matching de K simultáneos, fuerza bruta K≤4).
  function planForStart(
    ctx: EngineContext,
    planned: PlannedItem[],
    startUtc: Date,
    fixedStaff: string | null,
  ): PlannedAssignment[] | null {
    const assignments: PlannedAssignment[] = [];
    // intervalos ya usados por cada staff/resource dentro de este visit.
    const usedStaff = new Map<string, Array<[number, number]>>();
    const usedResource = new Map<string, Array<[number, number]>>();

    const freeWithinVisit = (
      used: Map<string, Array<[number, number]>>,
      id: string,
      s: number,
      e: number,
    ): boolean => {
      const arr = used.get(id);
      if (!arr) return true;
      return !arr.some(([us, ue]) => overlaps(s, e, us, ue));
    };
    const markUsed = (
      used: Map<string, Array<[number, number]>>,
      id: string,
      s: number,
      e: number,
    ): void => {
      const arr = used.get(id) ?? [];
      arr.push([s, e]);
      used.set(id, arr);
    };

    for (let i = 0; i < planned.length; i++) {
      const it = planned[i]!;
      const itemStart = new Date(startUtc.getTime() + it.startOffsetMin * 60000);
      const itemEnd = new Date(itemStart.getTime() + it.durationMin * 60000);
      const staffStart = new Date(
        itemStart.getTime() - it.bufferBeforeMin * 60000,
      );
      const staffEnd = new Date(itemEnd.getTime() + it.bufferAfterMin * 60000);
      const date = utcToWallDate(itemStart, CENTER_TZ);
      const needStartMin = timeToMinutes(utcToWallTime(staffStart, CENTER_TZ));
      const needEndMin = needStartMin + (it.durationMin +
        it.bufferBeforeMin + it.bufferAfterMin);

      // Candidatos de staff para este item.
      const skilled = ctx.skilledByService.get(it.serviceId) ?? new Set();
      const eligible: string[] = [];
      for (const u of skilled) {
        if (fixedStaff && u !== fixedStaff) continue;
        if (!templateCovers(ctx, u, date, needStartMin, needEndMin)) continue;
        if (!staffFree(ctx, u, staffStart, staffEnd)) continue;
        if (
          !freeWithinVisit(
            usedStaff,
            u,
            staffStart.getTime(),
            staffEnd.getTime(),
          )
        )
          continue;
        eligible.push(u);
      }
      if (eligible.length < it.staffRequired) return null;
      // Elige K deterministas (los primeros). Si hay staff fijado, debe estar.
      const chosen = eligible.slice(0, it.staffRequired);
      for (const u of chosen) {
        markUsed(usedStaff, u, staffStart.getTime(), staffEnd.getTime());
        assignments.push({
          appointmentItemIndex: i,
          reservableType: "STAFF",
          staffUserId: u,
          resourceId: null,
          startsAt: staffStart,
          endsAt: staffEnd,
        });
      }

      // Recursos por necesidad (por tipo, no por recurso concreto).
      const req = ctx.requirements.get(it.serviceId)!;
      for (const need of req.resourceNeeds) {
        const pool = ctx.resourcesByKind.get(need.resourceKind) ?? [];
        const picked: string[] = [];
        for (const rid of pool) {
          if (picked.length >= need.qty) break;
          if (!resourceFree(ctx, rid, staffStart, staffEnd)) continue;
          if (
            !freeWithinVisit(
              usedResource,
              rid,
              staffStart.getTime(),
              staffEnd.getTime(),
            )
          )
            continue;
          picked.push(rid);
        }
        if (picked.length < need.qty) return null;
        for (const rid of picked) {
          markUsed(usedResource, rid, staffStart.getTime(), staffEnd.getTime());
          assignments.push({
            appointmentItemIndex: i,
            reservableType: "RESOURCE",
            staffUserId: null,
            resourceId: rid,
            startsAt: staffStart,
            endsAt: staffEnd,
          });
        }
      }
    }
    return assignments;
  }

  // Genera los inicios de visit candidatos (UTC) en el rango, gridados a 15
  // min dentro de las ventanas de plantilla de cualquier profesional.
  function candidateStarts(
    ctx: EngineContext,
    spanMin: number,
  ): Date[] {
    const seen = new Set<string>();
    const out: Date[] = [];
    for (const [k, slots] of ctx.templateByUserDate) {
      const date = k.split("|")[1]!;
      for (const s of slots) {
        const fromMin = timeToMinutes(s.startTime);
        const toMin = timeToMinutes(s.endTime);
        for (const startMin of gridStarts(fromMin, toMin, spanMin, SLOT_MINUTES)) {
          const key = `${date}|${startMin}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(wallTimeToUtc(date, minutesToTime(startMin), CENTER_TZ));
        }
      }
    }
    out.sort((a, b) => a.getTime() - b.getTime());
    return out;
  }

  async function computeSlots(
    params: AvailabilityParams,
    reqMap: Map<string, ServiceRequirement>,
    planned: PlannedItem[],
    cap: number,
  ): Promise<Slot[]> {
    const ctx = await loadContext(params, reqMap);
    const span = visitSpanMin(planned);
    const fixed = params.staffUserId ?? null;
    const slots: Slot[] = [];
    for (const start of candidateStarts(ctx, span)) {
      const plan = planForStart(ctx, planned, start, fixed);
      if (plan) {
        const end = new Date(start.getTime() + span * 60000);
        slots.push({
          start: start.toISOString(),
          end: end.toISOString(),
          options: 1,
        });
        if (slots.length >= cap) break;
      }
    }
    return slots;
  }

  return {
    async availability(params) {
      const serviceIds = [...new Set(params.items.map((i) => i.serviceId))];
      const reqMap = await store.getServiceRequirements(
        params.tenantId,
        serviceIds,
      );
      const planned = deriveItems(params.items, reqMap);
      if (!planned) return [];
      return computeSlots(params, reqMap, planned, 200);
    },

    async hold(request) {
      // Idempotencia del alta offline por externalId.
      if (request.externalId) {
        const existing = await store.findByExternalId(
          request.tenantId,
          request.externalId,
        );
        if (existing) return { ok: true, appointment: existing, duplicate: true };
      }
      const serviceIds = [...new Set(request.items.map((i) => i.serviceId))];
      const reqMap = await store.getServiceRequirements(
        request.tenantId,
        serviceIds,
      );
      const planned = deriveItems(request.items, reqMap);
      if (!planned) return { ok: false, reason: "NO_REQUIREMENTS", alternatives: [] };

      const span = visitSpanMin(planned);
      const startUtc = new Date(request.start);
      const dateStr = utcToWallDate(startUtc, CENTER_TZ);
      const params: AvailabilityParams = {
        tenantId: request.tenantId,
        items: request.items,
        staffUserId: request.items.every((i) => i.staffUserId)
          ? // si TODOS los items fijan el mismo profesional, se respeta
            request.items[0]!.staffUserId
          : null,
        fromDate: dateStr,
        toDate: dateStr,
      };
      const ctx = await loadContext(params, reqMap);
      const plan = planForStart(ctx, planned, startUtc, params.staffUserId ?? null);
      if (!plan) {
        // No cabe: devolver alternativas del mismo día.
        const alternatives = await computeSlots(params, reqMap, planned, 10);
        return { ok: false, reason: "NO_SLOT", alternatives };
      }

      const input: HoldInput = {
        tenantId: request.tenantId,
        externalId: request.externalId,
        clientId: request.clientId,
        source: request.source,
        status: request.confirmed ? "CONFIRMED" : "PENDING",
        pendingUntil: request.confirmed
          ? null
          : new Date(Date.now() + request.pendingTtlMinutes * 60000),
        notes: request.notes,
        timeslotStart: startUtc,
        timeslotEnd: new Date(startUtc.getTime() + span * 60000),
        items: planned,
        assignments: plan,
      };
      try {
        const appointment = await store.insertHold(input);
        return { ok: true, appointment };
      } catch (err) {
        if (err instanceof ExclusionError) {
          // La BD ganó la carrera: hueco perdido, devolver alternativas.
          const alternatives = await computeSlots(params, reqMap, planned, 10);
          return { ok: false, reason: "TAKEN", alternatives };
        }
        throw err;
      }
    },

    confirm(tenantId, id) {
      return store.setStatus(tenantId, id, "CONFIRMED");
    },
    cancel(tenantId, id) {
      return store.setStatus(tenantId, id, "CANCELLED");
    },
    noShow(tenantId, id) {
      return store.setStatus(tenantId, id, "NO_SHOW");
    },
    setInService(tenantId, id) {
      return store.setStatus(tenantId, id, "IN_SERVICE");
    },
    complete(tenantId, id) {
      return store.setStatus(tenantId, id, "COMPLETED");
    },

    async reschedule(tenantId, id, newStartISO) {
      const current = await store.getAppointmentView(tenantId, id);
      if (!current) return { ok: false, reason: "NOT_FOUND", alternatives: [] };
      const requestItems: RequestItem[] = current.items.map((it) => ({
        serviceId: it.serviceId,
      }));
      const serviceIds = [...new Set(requestItems.map((i) => i.serviceId))];
      const reqMap = await store.getServiceRequirements(tenantId, serviceIds);
      const planned = deriveItems(requestItems, reqMap);
      if (!planned)
        return { ok: false, reason: "NO_REQUIREMENTS", alternatives: [] };
      const span = visitSpanMin(planned);
      const startUtc = new Date(newStartISO);
      const dateStr = utcToWallDate(startUtc, CENTER_TZ);
      const params: AvailabilityParams = {
        tenantId,
        items: requestItems,
        staffUserId: null,
        fromDate: dateStr,
        toDate: dateStr,
      };
      const ctx = await loadContext(params, reqMap);
      const plan = planForStart(ctx, planned, startUtc, null);
      if (!plan) {
        const alternatives = await computeSlots(params, reqMap, planned, 10);
        return { ok: false, reason: "NO_SLOT", alternatives };
      }
      try {
        const updated = await store.reschedule(
          tenantId,
          id,
          startUtc,
          new Date(startUtc.getTime() + span * 60000),
          plan,
        );
        if (!updated)
          return { ok: false, reason: "NOT_FOUND", alternatives: [] };
        return { ok: true, appointment: updated };
      } catch (err) {
        if (err instanceof ExclusionError) {
          const alternatives = await computeSlots(params, reqMap, planned, 10);
          return { ok: false, reason: "TAKEN", alternatives };
        }
        throw err;
      }
    },
  };
}
