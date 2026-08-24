import arcadiaHtml from "../arcadia.html?raw";
import socialPreview from "../og.png?inline";

const textHeaders = {
  "cache-control": "public, max-age=0, must-revalidate",
  "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
};

function decodeDataUrl(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/arcadia.html") {
      return new Response(arcadiaHtml, { headers: textHeaders });
    }

    if (url.pathname === "/og.png") {
      return new Response(decodeDataUrl(socialPreview), {
        headers: {
          "cache-control": "public, max-age=31536000, immutable",
          "content-type": "image/png",
        },
      });
    }

    return new Response("Not found", {
      headers: { "content-type": "text/plain; charset=utf-8" },
      status: 404,
    });
  },
};
