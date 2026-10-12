import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { createElement } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { type EntryContext, ServerRouter } from "react-router";
import { contentSecurityPolicy, createNonce } from "~/lib/security.server";
import { NonceProvider } from "./nonce";

export const streamTimeout = 5_000;

/** Like the default entry, plus a fresh CSP nonce per response that reaches every inline script. */
export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  const nonce = createNonce();
  if (process.env.NODE_ENV === "production") {
    responseHeaders.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  }
  return new Promise<Response>((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");
    const readyOption = (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? "onAllReady" : "onShellReady";
    const { pipe, abort } = renderToPipeableStream(
      createElement(
        NonceProvider,
        { value: nonce },
        createElement(ServerRouter, { context: routerContext, url: request.url, nonce }),
      ),
      {
        nonce,
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough();
          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(createReadableStreamFromReadable(body), {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) console.error(error);
        },
      },
    );
    setTimeout(abort, streamTimeout + 1000);
  });
}
