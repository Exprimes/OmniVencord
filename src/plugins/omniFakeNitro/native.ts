/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow, dialog, IpcMainInvokeEvent, OpenDialogOptions } from "electron";
import { statSync } from "fs";
import { basename } from "path";

import { postFile } from "./upload";

const LITTERBOX_MAX_SIZE = 1024 ** 3; // Au-delà : temp.sh (4 Go max, gardé 3 jours)
const ALLOWED_TIMES = new Set(["1h", "12h", "24h", "72h"]);

// Choisi ici et gardé ici : le renderer ne peut pas demander l'envoi d'un autre fichier du PC
let pickedPath: string | null = null;

export async function pickBigFile(event: IpcMainInvokeEvent) {
    const options: OpenDialogOptions = { properties: ["openFile"] };
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options));
    if (canceled || !filePaths[0]) return null;

    pickedPath = filePaths[0];
    return { name: basename(pickedPath), size: statSync(pickedPath).size };
}

let uploadProgress = 0;

export function getUploadProgress() {
    return uploadProgress;
}

let uploadAbort: AbortController | null = null;

export function cancelUpload() {
    uploadAbort?.abort();
}

// Renvoie null si l'envoi a été annulé
export async function uploadPickedFile(_: IpcMainInvokeEvent, time: string): Promise<string | null> {
    if (!pickedPath) throw new Error("Aucun fichier choisi.");
    const path = pickedPath;
    const name = basename(path);
    const { size } = statSync(path);
    const { signal } = uploadAbort = new AbortController();
    const onProgress = (sent: number) => uploadProgress = sent / size;
    const toTempSh = () => {
        uploadProgress = 0;
        return postFile("https://temp.sh/upload", {}, "file", path, name, onProgress, signal);
    };

    try {
        if (size > LITTERBOX_MAX_SIZE) return await toTempSh();

        uploadProgress = 0;
        try {
            return await postFile("https://litterbox.catbox.moe/resources/internals/api.php", {
                reqtype: "fileupload",
                time: ALLOWED_TIMES.has(time) ? time : "72h"
            }, "fileToUpload", path, name, onProgress, signal);
        } catch (litterboxError) {
            if (signal.aborted) throw litterboxError;
            try {
                return await toTempSh();
            } catch (tempShError) {
                throw new Error(`${(litterboxError as Error).message} / ${(tempShError as Error).message}`);
            }
        }
    } catch (e) {
        if (signal.aborted) return null;
        throw e;
    }
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

