import type { OpenClawPluginApi, PluginCommandContext } from "openclaw/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk", () => {
  return {
    approveDevicePairing: vi.fn(),
    listDevicePairing: vi.fn(),
    rejectDevicePairing: vi.fn(),
  };
});

type RegisteredCommand = {
  name: string;
  description: string;
  acceptsArgs?: boolean;
  handler: (ctx: PluginCommandContext) => Promise<{ text?: string }> | { text?: string };
};

function makeApi(params: {
  config: OpenClawPluginApi["config"];
  pluginConfig?: Record<string, unknown>;
}) {
  let registered: RegisteredCommand | undefined;
  const api = {
    id: "device-pair",
    name: "Device Pairing",
    source: "test",
    config: params.config,
    pluginConfig: params.pluginConfig,
    runtime: {} as unknown as OpenClawPluginApi["runtime"],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    registerCommand: (command) => {
      registered = command as unknown as RegisteredCommand;
    },
    registerTool: () => {},
    registerHook: () => {},
    registerHttpHandler: () => {},
    registerHttpRoute: () => {},
    registerChannel: () => {},
    registerGatewayMethod: () => {},
    registerCli: () => {},
    registerService: () => {},
    registerProvider: () => {},
    resolvePath: (input) => input,
    on: () => {},
  } as unknown as OpenClawPluginApi;

  return {
    api,
    getCommand: () => {
      if (!registered) {
        throw new Error("plugin did not register a command");
      }
      return registered;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("device-pair plugin", () => {
  it("registers /pair", async () => {
    const { default: register } = await import("./index.ts");
    const { api, getCommand } = makeApi({ config: {} });

    register(api);

    const cmd = getCommand();
    expect(cmd.name).toBe("pair");
    expect(cmd.acceptsArgs).toBe(true);
  });

  it("prints help", async () => {
    const { default: register } = await import("./index.ts");
    const { api, getCommand } = makeApi({ config: {} });
    register(api);

    const res = await getCommand().handler({
      channel: "telegram",
      isAuthorizedSender: true,
      args: "help",
      commandBody: "/pair help",
      config: {},
    });
    expect(res.text).toContain("/pair approve");
    expect(res.text).toContain("/pair reject");
  });

  it("shows pending requests", async () => {
    const { default: register } = await import("./index.ts");
    const sdk = await import("openclaw/plugin-sdk");
    const listDevicePairing = sdk.listDevicePairing as unknown as ReturnType<typeof vi.fn>;
    listDevicePairing.mockResolvedValue({ pending: [], paired: [] });

    const { api, getCommand } = makeApi({ config: {} });
    register(api);

    const res = await getCommand().handler({
      channel: "telegram",
      isAuthorizedSender: true,
      args: "pending",
      commandBody: "/pair pending",
      config: {},
    });
    expect(res.text).toContain("No pending device pairing requests.");
  });

  it("approves newest request when no requestId is provided", async () => {
    const { default: register } = await import("./index.ts");
    const sdk = await import("openclaw/plugin-sdk");
    const listDevicePairing = sdk.listDevicePairing as unknown as ReturnType<typeof vi.fn>;
    const approveDevicePairing = sdk.approveDevicePairing as unknown as ReturnType<typeof vi.fn>;

    listDevicePairing.mockResolvedValue({
      pending: [
        { requestId: "old", deviceId: "a", ts: 1 },
        { requestId: "new", deviceId: "b", ts: 2 },
      ],
      paired: [],
    });
    approveDevicePairing.mockResolvedValue({
      requestId: "new",
      device: {
        deviceId: "b",
        publicKey: "pk",
        createdAtMs: 1,
        approvedAtMs: 2,
      },
    });

    const { api, getCommand } = makeApi({ config: {} });
    register(api);

    const res = await getCommand().handler({
      channel: "telegram",
      isAuthorizedSender: true,
      args: "approve",
      commandBody: "/pair approve",
      config: {},
    });
    expect(approveDevicePairing).toHaveBeenCalledWith("new");
    expect(res.text).toContain("Paired b");
  });

  it("renders connection info from publicUrl + token auth", async () => {
    const { default: register } = await import("./index.ts");
    const { api, getCommand } = makeApi({
      config: {
        gateway: {
          auth: { mode: "token", token: "tok" },
        },
      },
      pluginConfig: { publicUrl: "https://example.com" },
    });
    register(api);

    const res = await getCommand().handler({
      channel: "telegram",
      isAuthorizedSender: true,
      args: "",
      commandBody: "/pair",
      config: api.config,
    });

    expect(res.text).toContain("Host: example.com");
    expect(res.text).toContain("Port: 443");
    expect(res.text).toContain("Use TLS: true");
    expect(res.text).toContain("Gateway Token: tok");
  });

  it("blocks unauthorized senders", async () => {
    const { default: register } = await import("./index.ts");
    const sdk = await import("openclaw/plugin-sdk");
    const listDevicePairing = sdk.listDevicePairing as unknown as ReturnType<typeof vi.fn>;
    const approveDevicePairing = sdk.approveDevicePairing as unknown as ReturnType<typeof vi.fn>;
    const rejectDevicePairing = sdk.rejectDevicePairing as unknown as ReturnType<typeof vi.fn>;

    const { api, getCommand } = makeApi({
      config: {
        gateway: {
          auth: { mode: "token", token: "tok" },
        },
      },
      pluginConfig: { publicUrl: "https://example.com" },
    });
    register(api);

    const pendingRes = await getCommand().handler({
      channel: "telegram",
      isAuthorizedSender: false,
      args: "pending",
      commandBody: "/pair pending",
      config: api.config,
    });
    expect(pendingRes.text).toContain("Not authorized");
    expect(listDevicePairing).not.toHaveBeenCalled();

    const approveRes = await getCommand().handler({
      channel: "telegram",
      isAuthorizedSender: false,
      args: "approve",
      commandBody: "/pair approve",
      config: api.config,
    });
    expect(approveRes.text).toContain("Not authorized");
    expect(approveDevicePairing).not.toHaveBeenCalled();

    const rejectRes = await getCommand().handler({
      channel: "telegram",
      isAuthorizedSender: false,
      args: "reject",
      commandBody: "/pair reject",
      config: api.config,
    });
    expect(rejectRes.text).toContain("Not authorized");
    expect(rejectDevicePairing).not.toHaveBeenCalled();

    const connectRes = await getCommand().handler({
      channel: "telegram",
      isAuthorizedSender: false,
      args: "",
      commandBody: "/pair",
      config: api.config,
    });
    expect(connectRes.text).toContain("Not authorized");
  });
});
