import { describe, expect, it } from "vitest";
import {
  extractChatCandidatesFromUpdates,
  extractWeakSignalsFromUpdates,
  type TelegramUpdate
} from "../src/telegram.js";

describe("extractChatCandidatesFromUpdates", () => {
  it("deduplicates by chat id and keeps most recent update", () => {
    const updates: TelegramUpdate[] = [
      {
        update_id: 100,
        message: {
          date: 1000,
          text: "old message",
          chat: { id: 1, type: "private", first_name: "Alice" }
        }
      },
      {
        update_id: 101,
        message: {
          date: 1001,
          text: "group ping",
          chat: { id: -2, type: "group", title: "Ops Group" }
        }
      },
      {
        update_id: 105,
        edited_message: {
          date: 1005,
          text: "new message",
          chat: { id: 1, type: "private", first_name: "Alice" }
        }
      }
    ];

    const candidates = extractChatCandidatesFromUpdates(updates);

    expect(candidates).toHaveLength(2);
    expect(candidates[0].chatId).toBe("1");
    expect(candidates[0].lastUpdateId).toBe(105);
    expect(candidates[0].lastMessage).toBe("new message");
    expect(candidates[1].chatId).toBe("-2");
  });

  it("returns empty list when no chat payload exists", () => {
    const updates: TelegramUpdate[] = [{ update_id: 1 }];
    expect(extractChatCandidatesFromUpdates(updates)).toEqual([]);
  });
});

describe("extractWeakSignalsFromUpdates", () => {
  it("matches `你是谁` and `/model` for a specific chat", () => {
    const updates: TelegramUpdate[] = [
      {
        update_id: 10,
        message: {
          text: "你是谁",
          chat: { id: 1001, type: "private" }
        }
      },
      {
        update_id: 11,
        message: {
          text: "/model@fasttttt7_bot",
          chat: { id: 1001, type: "private" }
        }
      },
      {
        update_id: 12,
        message: {
          text: "你是谁",
          chat: { id: 2002, type: "private" }
        }
      }
    ];

    const signals = extractWeakSignalsFromUpdates(updates, "1001");
    expect(signals).toEqual({
      askedWhoAmI: true,
      requestedModel: true
    });
  });

  it("ignores non-target chat and non-matching text", () => {
    const updates: TelegramUpdate[] = [
      {
        update_id: 21,
        message: {
          text: "hello",
          chat: { id: 3003, type: "private" }
        }
      },
      {
        update_id: 22,
        message: {
          text: "/help",
          chat: { id: 3003, type: "private" }
        }
      }
    ];

    const signals = extractWeakSignalsFromUpdates(updates, "3003");
    expect(signals).toEqual({
      askedWhoAmI: false,
      requestedModel: false
    });
  });
});
