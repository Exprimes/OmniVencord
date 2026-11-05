/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { IconComponent, PluginNative } from "@utils/types";
import { showToast, useEffect, useState } from "@webpack/common";

const Native = VencordNative.pluginHelpers.OmniFakeNitro as PluginNative<typeof import("./native")>;

const MAX_SIZE = 3 * 1024 ** 3;

export const BigUploadIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg width={width} height={height} viewBox="0 0 24 24" className={className}>
        <path fill="currentColor" d="M12 2a1 1 0 0 1 .7.3l5 5a1 1 0 0 1-1.4 1.4L13 5.4V16a1 1 0 1 1-2 0V5.4L7.7 8.7a1 1 0 0 1-1.4-1.4l5-5A1 1 0 0 1 12 2ZM4 15a1 1 0 0 1 1 1v3h14v-3a1 1 0 1 1 2 0v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Z" />
    </svg>
);

function formatSize(bytes: number) {
    return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} Go` : `${(bytes / 1024 ** 2).toFixed(1)} Mo`;
}

// Hors du composant : l'envoi continue si on change de salon et que le bouton est recréé
let uploading = false;

export function makeBigUploadButton(getTime: () => string): ChatBarButtonFactory {
    return ({ isMainChat }) => {
        const [progress, setProgress] = useState<number | null>(null);

        useEffect(() => {
            const timer = setInterval(async () => setProgress(uploading ? await Native.getUploadProgress() : null), 500);
            return () => clearInterval(timer);
        }, []);

        if (!isMainChat) return null;

        async function onClick() {
            if (uploading) {
                Native.cancelUpload();
                return;
            }

            // Après une mise à jour sans redémarrage complet, Discord tourne encore avec l'ancien code natif
            if (!Native.pickBigFile) {
                showToast({ text: "Quitte complètement Discord (clic droit sur l'icône près de l'horloge) puis rouvre-le.", variant: "critical" });
                return;
            }

            try {
                const file = await Native.pickBigFile();
                if (!file) return;

                if (file.size > MAX_SIZE) {
                    showToast({ text: `Fichier trop gros (${formatSize(file.size)}). Max 3 Go.`, variant: "critical" });
                    return;
                }

                uploading = true;
                setProgress(0);
                showToast({ text: `Upload de ${file.name} (${formatSize(file.size)})...`, variant: "default" });
                const url = await Native.uploadPickedFile(getTime());
                if (url === null) {
                    showToast({ text: "Upload annulé.", variant: "default" });
                    return;
                }

                insertTextIntoChatInputBox(url + " ");
                const kept = url.includes("temp.sh") ? " Le fichier reste 3 jours." : "";
                showToast({ text: `Upload terminé ! Lien ajouté au message.${kept}`, variant: "success" });
            } catch (e) {
                console.error("[OmniFakeNitro] Upload échoué", e);
                const reason = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
                showToast({ text: `Échec de l'upload : ${reason}`, variant: "critical" });
            } finally {
                uploading = false;
                setProgress(null);
            }
        }

        const percent = progress === null ? null : `${Math.min(100, Math.round(progress * 100))} %`;
        const tooltip = percent === null
            ? "Envoyer un gros fichier (jusqu'à 3 Go)"
            : `${progress! >= 1 ? "Fichier envoyé, le serveur le traite..." : `Upload en cours : ${percent}`} (clique pour annuler)`;

        return (
            <ChatBarButton tooltip={tooltip} onClick={onClick}>
                {percent === null ? <BigUploadIcon /> : <span className="omni-upload-percent">{percent}</span>}
            </ChatBarButton>
        );
    };
}
