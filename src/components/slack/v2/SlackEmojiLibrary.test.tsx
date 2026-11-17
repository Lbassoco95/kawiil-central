import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SlackEmojiLibrary } from "./SlackEmojiLibrary";

vi.mock("@/lib/slackApi", () => ({
  invokeSlackFileUpload: vi.fn(),
}));

function renderLibrary(onInsert = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SlackEmojiLibrary
        open
        onClose={() => {}}
        customEmoji={{ kawiil: "https://emoji.slack-edge.com/T/kawiil/abc.png" }}
        onSync={() => {}}
        onInsert={onInsert}
      />
    </QueryClientProvider>,
  );
  return onInsert;
}

describe("SlackEmojiLibrary", () => {
  it("muestra el emoji del workspace y lo inserta como shortcode", () => {
    const onInsert = renderLibrary();
    expect(screen.getByText(":kawiil:")).toBeInTheDocument();
    const button = screen.getByTitle("Insertar :kawiil:");
    expect(button.querySelector("img")).toHaveAttribute(
      "src",
      "https://emoji.slack-edge.com/T/kawiil/abc.png",
    );
    fireEvent.click(button);
    expect(onInsert).toHaveBeenCalledWith(":kawiil: ");
  });

  it("ofrece subir una imagen con nombre", () => {
    renderLibrary();
    expect(screen.getByText("Subir imagen")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre del emoji")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Subir" })).toBeDisabled();
  });
});
