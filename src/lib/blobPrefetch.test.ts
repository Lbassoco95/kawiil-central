import { describe, expect, it, vi } from "vitest";
import { createBlobCache } from "./blobPrefetch";

describe("createBlobCache", () => {
  it("comparte una sola descarga para la misma clave", async () => {
    const cache = createBlobCache();
    const loader = vi.fn(async () => new Blob(["a"]));
    const [a, b] = await Promise.all([cache.get("k", loader), cache.get("k", loader)]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    await cache.get("k", loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("si la descarga falla, la siguiente petición reintenta", async () => {
    const cache = createBlobCache();
    const loader = vi
      .fn<() => Promise<Blob>>()
      .mockRejectedValueOnce(new Error("red"))
      .mockResolvedValueOnce(new Blob(["ok"]));
    await expect(cache.get("k", loader)).rejects.toThrow("red");
    await expect(cache.get("k", loader)).resolves.toBeInstanceOf(Blob);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
