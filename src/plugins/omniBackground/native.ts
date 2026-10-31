/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

export async function resolveBackgroundUrl(_: IpcMainInvokeEvent, url: string): Promise<string> {
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
        console.error("[OmniBackground] Erreur lors de la résolution du lien:", e);
    }
    return url;
}
