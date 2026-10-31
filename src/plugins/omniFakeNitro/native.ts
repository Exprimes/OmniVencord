/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

const ALLOWED_TIMES = new Set(["1h", "12h", "24h", "72h"]);

export async function uploadToLitterbox(_: IpcMainInvokeEvent, data: Uint8Array, fileName: string, time: string): Promise<string> {
    if (!ALLOWED_TIMES.has(time)) time = "72h";

    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("time", time);
    form.append("fileToUpload", new Blob([data as unknown as BlobPart]), fileName);

    const res = await fetch("https://litterbox.catbox.moe/resources/internals/api.php", {
        method: "POST",
        body: form
    });

    const text = (await res.text()).trim();
    if (!res.ok || !text.startsWith("https://"))
        throw new Error(`Litterbox a refusé l'upload (${res.status}): ${text.slice(0, 200)}`);

    return text;
}

export async function resolveTenorUrl(_: IpcMainInvokeEvent, url: string): Promise<string> {
    if (!url || !url.includes("tenor.com")) return url;
    try {
        const res = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        });
        const html = await res.text();
        const match = html.match(/https:\/\/media[0-9]*\.tenor\.com\/m\/[^\s"'<>]+\.gif/);
        if (match && match[0]) {
            return match[0];
        }
    } catch (e) {
        console.error("[OmniFakeNitro] Impossible de résoudre le lien Tenor:", e);
    }
    return url;
}

