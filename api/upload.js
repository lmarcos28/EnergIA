
// api/upload.js
import { put } from "@vercel/blob";

export const config = {
  runtime: "edge",
};

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const form = await req.formData();
  const files = form.getAll("files");

  if (!files.length) {
    return new Response(JSON.stringify({ error: "No files sent" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const uploads = [];

  for (const file of files) {
    const safeName = file.name.replace(/\s+/g, "_");
    const { url } = await put(`uploads/${Date.now()}_${safeName}`, file, {
      access: "public",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    uploads.push(url);
  }

  return new Response(JSON.stringify({ ok: true, urls: uploads }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
