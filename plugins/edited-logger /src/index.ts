import { findByName, findByProps } from "@vendetta/metro";
import { FluxDispatcher, ReactNative, React } from "@vendetta/metro/common";
import { after, before, instead } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";

const patches = [];
const ChannelMessages = findByProps("_channelMessages");
const MessageRecordUtils = findByProps("updateMessageRecord", "createMessageRecord");
const MessageRecord = findByName("MessageRecord", false);
const RowManager = findByName("RowManager");
const Text = findByName("Text");

// 🔸 Detect message edits
patches.push(before("dispatch", FluxDispatcher, ([event]) => {
  if (event.type === "MESSAGE_UPDATE") {
    const channel = ChannelMessages.get(event.message.channel_id);
    if (!channel) return event;

    const oldMessage = channel.get(event.message.id);
    const newMessage = event.message;

    // Skip non-content edits
    if (!oldMessage || oldMessage.content === newMessage.content) return event;

    // Ignore system/failed messages
    if (newMessage.author?.id === "1" || newMessage.state === "SEND_FAILED") return event;

    // Save log to storage
    storage.edits = storage.edits || {};
    storage.edits[newMessage.id] = {
      old: oldMessage.content,
      new: newMessage.content,
      author: newMessage.author?.username || "Unknown",
      channelId: newMessage.channel_id,
      timestamp: Date.now(),
    };

    // Inject markers
    return [{
      message: {
        ...newMessage,
        __vml_edited: true,
        __vml_oldContent: oldMessage.content,
      },
      type: "MESSAGE_UPDATE",
    }];
  }
}));

// 🔸 Highlight edited messages slightly
patches.push(after("generate", RowManager.prototype, ([data], row) => {
  if (data.rowType !== 1) return;
  if (data.message.__vml_edited) {
    row.message.edited = "edited";
    row.backgroundHighlight ??= {};
    row.backgroundHighlight.backgroundColor = ReactNative.processColor("#f5b04222");
    row.backgroundHighlight.gutterColor = ReactNative.processColor("#f5b042ff");
  }
}));

// 🔸 Show old message ABOVE the new one in gray
patches.push(after("default", MessageRecord, ([props], record, ret) => {
  if (!props.__vml_oldContent) return ret;

  try {
    const original = React.createElement(
      Text,
      {
        style: {
          fontSize: 11,
          color: "#999",
          marginBottom: 2,
        },
        numberOfLines: 5,
      },
      props.__vml_oldContent
    );

    const edited = React.createElement(
      React.Fragment,
      null,
      original,
      ret
    );

    return edited;
  } catch (e) {
    console.error("[VML] Failed to render original message:", e);
    return ret;
  }
}));

// 🔸 Record persistence
patches.push(instead("updateMessageRecord", MessageRecordUtils, function ([oldRecord, newRecord], orig) {
  if (newRecord.__vml_edited) {
    return MessageRecordUtils.createMessageRecord(newRecord, oldRecord.reactions);
  }
  return orig.apply(this, [oldRecord, newRecord]);
}));

patches.push(after("createMessageRecord", MessageRecordUtils, function ([message], record) {
  record.__vml_edited = message.__vml_edited;
}));

patches.push(after("default", MessageRecord, ([props], record) => {
  record.__vml_edited = !!props.__vml_edited;
}));

// 🔸 Cleanup
export const onUnload = () => {
  patches.forEach(unpatch => unpatch());
};

export { default as settings } from "./settings";
