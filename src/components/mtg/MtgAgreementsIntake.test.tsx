import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MtgAgreementsIntake } from "./MtgAgreementsIntake";
import type { MtgMeetingRow } from "@/lib/mtg/db";

const mocks = vi.hoisted(() => ({ assign: vi.fn(), capture: vi.fn(), proposed: vi.fn(), error: vi.fn() }));
vi.mock("@/hooks/useClients", () => ({ useClients: () => ({ data: [{ id: "c1", name: "Empresa A" }, { id: "c2", name: "Empresa B" }] }) }));
vi.mock("@/hooks/useClientGroups", () => ({
  useClientGroups: () => ({ data: [{ id: "g1", name: "Grupo Sylon" }] }),
  useAllClientGroupMembers: () => ({ data: [{ group_id: "g1", client_id: "c1" }, { group_id: "g1", client_id: "c2" }] }),
}));
vi.mock("@/hooks/useTasks", () => ({ useProfiles: () => ({ data: [{ user_id: "u1", full_name: "Ana" }] }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [{ id: "p1", name: "Proyecto A", client_id: "c1" }, { id: "p2", name: "Proyecto B", client_id: "c2" }] }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/mtg/assignMeetingClients", () => ({ assignMeetingClients: mocks.assign }));
vi.mock("@/lib/mtg/captureAgreement", () => ({ captureAgreement: mocks.capture }));
vi.mock("@/lib/mtg/commitments", () => ({
  parseCommitments: () => [{ text: "Revisar contrato", owner: "Ana", dueDate: "2026-10-25", dueHint: null, ref: null }],
  matchProfileByName: () => ({ user_id: "u1" }),
  addProposedAgreements: mocks.proposed,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: mocks.error } }));

const entities = [{ key: "a", label: "Empresa A", client_id: "c1" }, { key: "b", label: "Empresa B", client_id: "c2" }];
function setup() {
  return render(<MtgAgreementsIntake organizationId="org" actorUserId="u1" meeting={{ id: "m1", client_id: null } as MtgMeetingRow} series={null} minutesMd="minuta" agreements={[]} onChanged={vi.fn()} />);
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.assign.mockImplementation(async ({ clientIds }: { clientIds: string[] }) => ({ entities: entities.filter((e) => clientIds.includes(e.client_id)) }));
  mocks.capture.mockResolvedValue({});
});

describe("MtgAgreementsIntake grupos", () => {
  it("permite seleccionar el grupo y guardar solo sus clientes participantes", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Cliente o grupo de la junta"), { target: { value: "group:g1" } });
    expect(screen.getByRole("checkbox", { name: "Empresa A" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Empresa B" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar clientes de la junta" }));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith({ organizationId: "org", actorUserId: "u1", meetingId: "m1", clientIds: ["c1"] }));
  });

  it("también permite vincular un cliente individual", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Cliente o grupo de la junta"), { target: { value: "client:c2" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar clientes de la junta" }));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith(expect.objectContaining({ clientIds: ["c2"] })));
    expect(await screen.findByText("Cliente: Empresa B")).toBeInTheDocument();
  });

  it("filtra proyectos por cliente y crea la tarea con el cliente y entidad correctos", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Cliente o grupo de la junta"), { target: { value: "group:g1" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar clientes de la junta" }));
    const clientSelect = await screen.findByLabelText("Cliente de esta tarea");
    fireEvent.change(clientSelect, { target: { value: "c2" } });
    const projectSelect = screen.getByTitle("Proyecto de esta tarea");
    expect(within(projectSelect).queryByRole("option", { name: /Proyecto A/ })).toBeNull();
    fireEvent.change(projectSelect, { target: { value: "p2" } });
    fireEvent.click(screen.getByRole("button", { name: /Cargar 1 como tareas/ }));
    await waitFor(() => expect(mocks.capture).toHaveBeenCalledWith(expect.objectContaining({ clientId: "c2", entityKey: "b", projectId: "p2", confirm: true })));
  });

  it("no asigna acuerdos manuales al primer cliente del grupo por defecto", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Cliente o grupo de la junta"), { target: { value: "group:g1" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar clientes de la junta" }));
    const clientSelect = await screen.findByLabelText("Cliente para acuerdos propuestos o manuales");
    fireEvent.change(screen.getByPlaceholderText("Agregar otro acuerdo (qué se compromete y quién)"), { target: { value: "Enviar documentos" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(mocks.proposed).not.toHaveBeenCalled();
    fireEvent.change(clientSelect, { target: { value: "b" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    await waitFor(() => expect(mocks.proposed).toHaveBeenCalledWith(expect.objectContaining({ clientId: "c2", entityKey: "b" })));
  });

  it("conserva la selección si falla el guardado para permitir reintentar", async () => {
    mocks.assign.mockRejectedValueOnce(new Error("Sin conexión"));
    setup();
    fireEvent.change(screen.getByLabelText("Cliente o grupo de la junta"), { target: { value: "group:g1" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar clientes de la junta" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Sin conexión"));
    expect(screen.getByRole("checkbox", { name: "Empresa A" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Guardar clientes de la junta" })).toBeEnabled();
  });

  it("no crea tareas mientras la selección de grupo no esté guardada", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Cliente o grupo de la junta"), { target: { value: "group:g1" } });
    fireEvent.click(screen.getByRole("button", { name: /Cargar 1 como tareas/ }));
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith("Guarda primero los clientes de la junta");
  });
});
