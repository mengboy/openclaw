import { beforeEach, describe, expect, it, vi } from "vitest";

const createFeishuClientMock = vi.hoisted(() => vi.fn());
const resolveFeishuAccountMock = vi.hoisted(() => vi.fn());
const normalizeFeishuTargetMock = vi.hoisted(() => vi.fn());
const resolveReceiveIdTypeMock = vi.hoisted(() => vi.fn());

const fileCreateMock = vi.hoisted(() => vi.fn());
const imageCreateMock = vi.hoisted(() => vi.fn());
const messageCreateMock = vi.hoisted(() => vi.fn());
const messageReplyMock = vi.hoisted(() => vi.fn());

vi.mock("./client.js", () => ({
  createFeishuClient: createFeishuClientMock,
}));

vi.mock("./accounts.js", () => ({
  resolveFeishuAccount: resolveFeishuAccountMock,
}));

vi.mock("./targets.js", () => ({
  normalizeFeishuTarget: normalizeFeishuTargetMock,
  resolveReceiveIdType: resolveReceiveIdTypeMock,
}));

import { sendMediaFeishu } from "./media.js";

describe("sendMediaFeishu msg_type routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    resolveFeishuAccountMock.mockReturnValue({
      configured: true,
      accountId: "main",
      appId: "app_id",
      appSecret: "app_secret",
      domain: "feishu",
    });

    normalizeFeishuTargetMock.mockReturnValue("ou_target");
    resolveReceiveIdTypeMock.mockReturnValue("open_id");

    createFeishuClientMock.mockReturnValue({
      im: {
        file: {
          create: fileCreateMock,
        },
        image: {
          create: imageCreateMock,
        },
        message: {
          create: messageCreateMock,
          reply: messageReplyMock,
        },
      },
    });

    fileCreateMock.mockResolvedValue({
      code: 0,
      data: { file_key: "file_key_1" },
    });

    imageCreateMock.mockResolvedValue({
      code: 0,
      data: { image_key: "img_key_1" },
    });

    messageCreateMock.mockResolvedValue({
      code: 0,
      data: { message_id: "msg_1" },
    });

    messageReplyMock.mockResolvedValue({
      code: 0,
      data: { message_id: "reply_1" },
    });
  });

  it("uses msg_type=media for mp4", async () => {
    await sendMediaFeishu({
      cfg: {} as any,
      to: "user:ou_target",
      mediaBuffer: Buffer.from("video"),
      fileName: "clip.mp4",
    });

    expect(fileCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ file_type: "mp4" }),
      }),
    );

    expect(messageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ msg_type: "media" }),
      }),
    );
  });

  it("uses msg_type=media for opus", async () => {
    await sendMediaFeishu({
      cfg: {} as any,
      to: "user:ou_target",
      mediaBuffer: Buffer.from("audio"),
      fileName: "voice.opus",
    });

    expect(fileCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ file_type: "opus" }),
      }),
    );

    expect(messageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ msg_type: "media" }),
      }),
    );
  });

  it("uses msg_type=file for documents", async () => {
    await sendMediaFeishu({
      cfg: {} as any,
      to: "user:ou_target",
      mediaBuffer: Buffer.from("doc"),
      fileName: "paper.pdf",
    });

    expect(fileCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ file_type: "pdf" }),
      }),
    );

    expect(messageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ msg_type: "file" }),
      }),
    );
  });

  it("uses msg_type=media when replying with mp4", async () => {
    await sendMediaFeishu({
      cfg: {} as any,
      to: "user:ou_target",
      mediaBuffer: Buffer.from("video"),
      fileName: "reply.mp4",
      replyToMessageId: "om_parent",
    });

    expect(messageReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { message_id: "om_parent" },
        data: expect.objectContaining({ msg_type: "media" }),
      }),
    );

    expect(messageCreateMock).not.toHaveBeenCalled();
  });


  it("uses msg_type=image for remote image URL without extension", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "image/png" : null) },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as any);

    await sendMediaFeishu({
      cfg: {} as any,
      to: "user:ou_target",
      mediaUrl: "https://example.com/download?id=1",
    });

    expect(imageCreateMock).toHaveBeenCalledTimes(1);
    expect(messageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ msg_type: "image" }),
      }),
    );

    fetchMock.mockRestore();
  });
});
