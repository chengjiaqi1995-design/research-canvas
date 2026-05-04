# Research Canvas Clipper

Chrome MV3 unpacked extension for sending selected webpage text into Research Canvas AI Process.

## Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this folder:

```text
/Users/jiaqi/research-canvas/chrome-extension/research-canvas-clipper
```

## Connect On Each Computer

1. Open Research Canvas and sign in.
2. Click the extension icon.
3. Click "连接当前 Research Canvas 标签页".

The Research Canvas URL and behavior settings use Chrome Sync. The auth token is stored in `chrome.storage.local`, so every computer needs its own connection step. This avoids syncing session tokens to corporate or shared machines.

## Use

- Select webpage text, right click, choose "发送选中文本到 Research Canvas".
- Right click an image and choose "发送图片引用到 Research Canvas".
- Use the popup to send the current selection or full page text.

The uploaded note uses `/api/transcriptions/from-text`, so it appears in AI Process as a `note`. When "自动总结/元数据" is enabled, the extension reads your saved AI settings from `/api/ai/settings?revealKeys=1` and submits the same summary prompt, metadata prompt, model, and provider keys used by AI Process.

## Network Notes

- Prefer the frontend URL, for example `https://research-canvas-jxycyus54a-as.a.run.app`; the extension calls the same-origin `/api` proxy from there.
- Requests send both `Authorization: Bearer ...` and `X-Auth-Token: ...`. The second header is a fallback for company proxies that strip or alter `Authorization`.
- The extension has no build step and no remote dependencies.

## Current Image Behavior

Images are preserved as source URLs, alt text, titles, and dimensions in the uploaded Markdown note. OCR or multimodal image understanding should be added as a separate future action.
