/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createReadStream, statSync } from "fs";
import { request } from "https";

// Lit le fichier depuis le disque au fur et à mesure : sa taille n'a aucun effet sur la mémoire utilisée
export function postFile(url: string, fields: Record<string, string>, fileField: string, path: string, fileName: string, onProgress?: (sent: number) => void) {
    return new Promise<string>((resolve, reject) => {
        const boundary = `----OmniUpload${Date.now()}`;
        const textParts = Object.entries(fields).map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
        const head = Buffer.from(`${textParts.join("")}--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName.replace(/["\r\n]/g, "_")}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
        const tail = Buffer.from(`\r\n--${boundary}--\r\n`);

        const req = request(url, {
            method: "POST",
            headers: {
                "Content-Type": `multipart/form-data; boundary=${boundary}`,
                "Content-Length": head.length + statSync(path).size + tail.length,
                "User-Agent": "OmniFakeNitro"
            }
        }, res => {
            let text = "";
            res.setEncoding("utf8");
            res.on("data", chunk => text += chunk);
            res.on("error", reject);
            res.on("end", () => {
                text = text.trim();
                if (res.statusCode === 200 && /^https?:\/\//.test(text)) resolve(text);
                else reject(new Error(`${new URL(url).hostname} a refusé le fichier (${res.statusCode}) : ${text.slice(0, 200)}`));
            });
        });
        req.on("error", reject);

        const file = createReadStream(path);
        file.on("error", e => req.destroy(e));
        file.on("end", () => req.end(tail));
        let sent = 0;
        file.on("data", chunk => onProgress?.(sent += chunk.length));
        req.write(head);
        file.pipe(req, { end: false });
    });
}
