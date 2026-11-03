/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "./styles.css";

import { addProfileBadge, BadgePosition, ProfileBadge, removeProfileBadge } from "@api/Badges";
import { addMessagePreEditListener, addMessagePreSendListener, removeMessagePreEditListener, removeMessagePreSendListener } from "@api/MessageEvents";
import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings, Settings } from "@api/Settings";
import { disableStyle, enableStyle } from "@api/Styles";
import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { ApngBlendOp, ApngDisposeOp, parseAPNG } from "@utils/apng";
import { Devs } from "@utils/constants";
import { copyWithToast, fetchUserProfile, getCurrentGuild } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { useAwaiter } from "@utils/react";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import type { CloudUpload as TCloudUpload, Emoji, Message, RenderModalProps, Sticker } from "@vencord/discord-types";
import { CloudUploadPlatform, StickerFormatType } from "@vencord/discord-types/enums";
import { findByCodeLazy, findByPropsLazy, findLazy, proxyLazyWebpack } from "@webpack";
import { ChannelStore, ConfirmModal, DraftType, EmojiStore, FluxDispatcher, GuildMemberStore, GuildStore, IconUtils, openModal, PermissionsBits, PermissionStore, showToast, StickersStore, Tooltip, UploadHandler, UserProfileStore, UserSettingsActionCreators, UserSettingsProtoStore, UserStore } from "@webpack/common";
import omniLogo from "file://omni_logo.webp?base64";
import { applyPalette, GIFEncoder, quantize } from "gifenc";
import type { ReactElement, ReactNode } from "react";

import { BigUploadIcon, makeBigUploadButton } from "./BigUploadButton";
import neonStyle from "./neon.css?managed";
import { decodeOmniProfile, encodeOmniProfile, isShareable, OmniProfile } from "./omniProfile";

const Native = VencordNative.pluginHelpers.OmniFakeNitro as PluginNative<typeof import("./native")>;

const tenorCache = new Map<string, string>();

function cleanMediaUrl(rawUrl?: string): string {
    if (!rawUrl) return "";
    const trimmed = rawUrl.trim();
    if (trimmed.includes("tenor.com") && !trimmed.endsWith(".gif") && !trimmed.endsWith(".webp") && !trimmed.endsWith(".png")) {
        if (trimmed.includes("14744196391700581923") || trimmed.includes("made-by-aur")) {
            return "https://media1.tenor.com/m/zJ3ogAnoziMAAAAC/made-by-aur.gif";
        }
        if (trimmed.includes("5899936184374550214") || trimmed.includes("solo-gif")) {
            return "https://media1.tenor.com/m/UeDIs1MeXsYAAAAC/solo.gif";
        }
        if (trimmed.includes("bleach")) {
            return "https://media1.tenor.com/m/fr2fVytuzdQAAAAC/bleach.gif";
        }
        if (trimmed.includes("sjw-solo-leveling") || trimmed.includes("solo-leveling")) {
            return "https://media1.tenor.com/m/ptML0UoWC3AAAAAC/sjw-solo-leveling.gif";
        }
        if (tenorCache.has(trimmed)) {
            return tenorCache.get(trimmed)!;
        }
        // Tentative de résolution en tâche de fond pour les prochains affichages
        Native.resolveTenorUrl(trimmed).then(res => {
            if (res && res.endsWith(".gif")) {
                tenorCache.set(trimmed, res);
            }
        }).catch(() => {});
    }
    return trimmed;
}

function findCustomEmojiByName(emojiName: string): any {
    const nameLower = emojiName.toLowerCase();

    // 1. Chercher dans tous les serveurs dont l'utilisateur est membre
    try {
        const guilds = GuildStore?.getGuilds?.();
        if (guilds) {
            for (const guildId of Object.keys(guilds)) {
                const list = EmojiStore.getGuildEmoji?.(guildId);
                if (Array.isArray(list)) {
                    const found = list.find((e: any) => e.name?.toLowerCase() === nameLower);
                    if (found) return found;
                }
            }
        }
    } catch {}

    // 2. Chercher dans les collections internes d'EmojiStore
    try {
        const storeGuilds = (EmojiStore as any).getGuilds?.();
        if (storeGuilds) {
            for (const gId of Object.keys(storeGuilds)) {
                const list = storeGuilds[gId]?.emojis;
                if (Array.isArray(list)) {
                    const found = list.find((e: any) => e.name?.toLowerCase() === nameLower);
                    if (found) return found;
                }
            }
        }
    } catch {}

    // 3. Chercher dans le contexte disambiguated
    try {
        const ctx = (EmojiStore as any).getDisambiguatedEmojiContext?.();
        const custom = ctx?.getCustomEmojis?.() || ctx?._customEmojis;
        if (Array.isArray(custom)) {
            const found = custom.find((e: any) => e.name?.toLowerCase() === nameLower);
            if (found) return found;
        }
    } catch {}

    return null;
}


// getUserProfile d'origine (avant notre hook), pour lire la vraie bio des autres sans boucler
let rawGetProfile: ((userId: string) => any) | null = null;
const getRawProfile = (userId: string) => (rawGetProfile ?? UserProfileStore.getUserProfile).call(UserProfileStore, userId);

const omniProfileCache = new Map<string, { bio: string; data: OmniProfile | null; }>();

// Profil Omni d'un autre utilisateur, lu dans sa bio (null s'il n'a pas mis de code ou si son profil n'est pas chargé)
function othersOmniProfile(userId: string): OmniProfile | null {
    const bio: string | undefined = getRawProfile(userId)?.bio;
    if (!bio) return null;

    const cached = omniProfileCache.get(userId);
    if (cached?.bio === bio) return cached.data;

    const data = decodeOmniProfile(bio);
    omniProfileCache.set(userId, { bio, data });
    return data;
}

const isMe = (userId?: string) => !!userId && userId === UserStore.getCurrentUser()?.id;

// Mêmes cartes que dans neon.css : on y met la couleur d'aura de la personne affichée
const NEON_CARDS = 'div[class*="biteSize_"], div[class*="fullSize_"], div[class*="userProfileOuter_"], div[class*="userPopoutOuter_"], div[class*="outer_"], div[role="dialog"], div[class*="accountProfilePopout_"]';

function setCardNeonColor(badge: HTMLElement | null, color: string) {
    let card: HTMLElement | null | undefined = badge?.closest<HTMLElement>(NEON_CARDS);
    // la plus haute carte, pour que toutes les cartes imbriquées héritent de la couleur
    for (let up = card?.parentElement?.closest<HTMLElement>(NEON_CARDS); up; up = up.parentElement?.closest<HTMLElement>(NEON_CARDS)) card = up;
    card?.style.setProperty("--omni-neon", color);
}

const omniBadge: ProfileBadge = {
    id: "omni-vip-badge",
    description: "Soutien Omni",
    position: BadgePosition.START,
    shouldShow: ({ userId }) => isMe(userId) ? settings.store.enableOmniBadge : othersOmniProfile(userId) != null,
    component: ({ userId }) => (
        <Tooltip text="Soutien Omni">
            {tooltipProps => (
                <img
                    {...tooltipProps}
                    ref={el => setCardNeonColor(el, isMe(userId) ? settings.store.neonColor : othersOmniProfile(userId)?.color ?? DEFAULT_NEON_COLOR)}
                    src={`data:image/webp;base64,${omniLogo}`}
                    alt="Soutien Omni"
                    width={20}
                    height={20}
                    className="omni-vip-badge"
                    style={{
                        borderRadius: "50%",
                        filter: "drop-shadow(0 0 4px #a855f7)",
                        cursor: "pointer",
                        marginRight: "4px"
                    }}
                />
            )}
        </Tooltip>
    )
};

const BINARY_READ_OPTIONS = findByPropsLazy("readerFactory");
const CloudUpload: typeof TCloudUpload = findLazy(m => m.prototype?.trackUploadFinished);

function searchProtoClassField(localName: string, protoClass: any) {
    const field = protoClass?.fields?.find((field: any) => field.localName === localName);
    if (!field) return;

    const fieldGetter = Object.values(field).find(value => typeof value === "function") as any;
    return fieldGetter?.();
}

const logger = new Logger("OmniFakeNitro");

const PreloadedUserSettingsActionCreators = proxyLazyWebpack(() => UserSettingsActionCreators.PreloadedUserSettingsActionCreators);
const AppearanceSettingsActionCreators = proxyLazyWebpack(() => searchProtoClassField("appearance", PreloadedUserSettingsActionCreators.ProtoClass));
const ClientThemeSettingsActionsCreators = proxyLazyWebpack(() => searchProtoClassField("clientThemeSettings", AppearanceSettingsActionCreators));

const isUnusableRoleSubscriptionEmoji = findByCodeLazy(".getUserIsAdmin(");

const enum EmojiIntentions {
    REACTION,
    STATUS,
    COMMUNITY_CONTENT,
    CHAT,
    GUILD_STICKER_RELATED_EMOJI,
    GUILD_ROLE_BENEFIT_EMOJI,
    COMMUNITY_CONTENT_ONLY,
    SOUNDBOARD,
    VOICE_CHANNEL_TOPIC,
    GIFT,
    AUTO_SUGGESTION,
    POLLS
}

const IS_BYPASSEABLE_INTENTION = `[${EmojiIntentions.CHAT},${EmojiIntentions.GUILD_STICKER_RELATED_EMOJI}].includes(fakeNitroIntention)`;

const enum FakeNoticeType {
    Sticker,
    Emoji
}

const fakeNitroEmojiRegex = /\/emojis\/(\d+?)\.(png|webp|gif)/;
const fakeNitroStickerRegex = /\/stickers\/(\d+?)\./;
const fakeNitroGifStickerRegex = /\/attachments\/\d+?\/\d+?\/(\d+?)\.gif/;
const hyperLinkRegex = /\[.+?\]\((https?:\/\/.+?)\)/;
const hyperLinkOnlyRegex = new RegExp(`^${hyperLinkRegex.source}$`);
const mediaSizes = [16, 32, 48, 56, 64, 96, 128, 160, 256, 512, 1024];

const DEFAULT_EMOJI_SIZE = 48;
const DEFAULT_STICKER_SIZE = 160;

const DEFAULT_NEON_COLOR = "#a855f7";

// Variable CSS dans notre propre <style> : Discord réécrit le style de <html> au démarrage
const neonColorStyle = document.createElement("style");
neonColorStyle.dataset.vencordName = "omni-neon-color";

function applyNeonColor() {
    const color = /^#[0-9a-f]{6}$/i.test(settings.store.neonColor) ? settings.store.neonColor : DEFAULT_NEON_COLOR;
    neonColorStyle.textContent = `:root{--omni-neon:${color}}`;
    document.head.append(neonColorStyle);
}

function NeonColorPicker() {
    const { neonColor } = settings.use(["neonColor"]);
    return (
        <div className="omni-neon-picker">
            <Heading>Couleur de l'aura néon</Heading>
            <input
                type="color"
                value={neonColor}
                onChange={e => {
                    settings.store.neonColor = e.currentTarget.value;
                    applyNeonColor();
                }}
            />
            <Button size="small" variant="secondary" onClick={() => { settings.store.neonColor = DEFAULT_NEON_COLOR; applyNeonColor(); }}>
                Couleur par défaut
            </Button>
        </div>
    );
}

function ShareOmniProfile() {
    const s = settings.use(["customAvatarUrl", "customBannerUrl", "neonColor"]);
    // Charge ta propre bio (sinon on ne peut pas dire si le code y est déjà)
    const [, , loading] = useAwaiter(() => fetchUserProfile(UserStore.getCurrentUser().id));
    if (loading) return null;

    const avatar = cleanMediaUrl(s.customAvatarUrl);
    const banner = cleanMediaUrl(s.customBannerUrl);
    const color = /^#[0-9a-f]{6}$/i.test(s.neonColor) ? s.neonColor : DEFAULT_NEON_COLOR;
    const code = encodeOmniProfile({ avatar, banner, color });

    const inBio = decodeOmniProfile(getRawProfile(UserStore.getCurrentUser().id)?.bio);
    const upToDate = inBio != null && encodeOmniProfile(inBio) === code;
    const notShared = [["avatar", avatar], ["bannière", banner]].filter(([, url]) => url && !isShareable(url)).map(([name]) => name);

    return (
        <div className="omni-share">
            <Heading>Partager mon profil Omni</Heading>
            <Paragraph>
                Les autres utilisateurs d'OmniFakeNitro verront ton avatar, ta bannière, ton badge et ton aura (avec ta couleur).
                Copie le code invisible et colle-le n'importe où dans ta bio (Paramètres → Profils → À propos de moi).
                Recopie-le après chaque changement d'avatar, de bannière ou de couleur.
            </Paragraph>
            <Paragraph className={upToDate ? "omni-share-ok" : "omni-share-warn"}>
                {upToDate ? "✅ Ta bio contient ton code à jour." : inBio ? "⚠️ Le code de ta bio n'est plus à jour : recopie-le." : "⚠️ Ton code n'est pas encore dans ta bio."}
            </Paragraph>
            {notShared.length > 0 && (
                <Paragraph className="omni-share-warn">
                    ⚠️ Ton {notShared.join(" et ta ")} ne sera pas partagé(e) : héberge l'image sur files.catbox.moe (ou i.imgur.com) pour que les autres puissent la voir.
                </Paragraph>
            )}
            <Button size="small" onClick={() => copyWithToast(code, "Code copié ! Colle-le dans ta bio.")}>
                Copier le code invisible ({[...code].length} caractères)
            </Button>
        </div>
    );
}

const settings = definePluginSettings({
    enableEmojiBypass: {
        displayName: "Débloquer les Emojis",
        description: "Permet d'envoyer n'importe quel emoji externe même sans abonnement Nitro",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true
    },
    emojiSize: {
        displayName: "Taille des Emojis",
        description: "Taille de l'emoji affiché lors de l'envoi",
        type: OptionType.SELECT,
        default: DEFAULT_EMOJI_SIZE,
        options: mediaSizes.map(size => ({
            label: `${size}px`,
            value: size
        }))
    },
    transformEmojis: {
        displayName: "Convertir en vrais Emojis",
        description: "Affiche les emojis externes comme de vrais emojis intégrés plutôt que de simples liens",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true
    },
    enableStickerBypass: {
        displayName: "Débloquer les Autocollants (Stickers)",
        description: "Permet d'utiliser tous les stickers personnalisés de n'importe quel serveur",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true
    },
    stickerSize: {
        displayName: "Taille des Autocollants",
        description: "Taille du sticker lors de l'envoi",
        type: OptionType.SELECT,
        default: DEFAULT_STICKER_SIZE,
        options: mediaSizes.map(size => ({
            label: `${size}px`,
            value: size
        }))
    },
    transformStickers: {
        displayName: "Convertir en vrais Autocollants",
        description: "Rend les stickers externes comme de véritables autocollants animés",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true
    },
    transformCompoundSentence: {
        displayName: "Convertir dans les phrases complètes",
        description: "Permet d'intégrer les emojis/stickers même dans les phrases contenant du texte",
        type: OptionType.BOOLEAN,
        default: true
    },
    enableStreamQualityBypass: {
        displayName: "Qualité de Stream Nitro (1080p 60 FPS)",
        description: "Débloque la haute résolution 1080p et la fluidité 60 FPS en partage d'écran sans boost",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true
    },
    hideEmojiLinks: {
        displayName: "Zéro lien (emojis en image jointe)",
        description: "Envoie les emojis et stickers comme images jointes au message : aucun lien visible, même pour ceux qui n'ont pas le plugin. L'image apparaît sous le texte, pas dans la phrase. Les messages modifiés gardent un lien.",
        type: OptionType.BOOLEAN,
        default: true
    },
    useHyperLinks: {
        displayName: "Utiliser des liens texte (Hyperliens)",
        description: "DÉSACTIVÉ RECOMMANDÉ : Si activé, Discord affiche juste le nom du texte '[Dbd]' au lieu de l'image de l'emoji",
        type: OptionType.BOOLEAN,
        default: false
    },
    hyperLinkText: {
        displayName: "Format du texte de lien",
        description: "Texte affiché pour l'emoji (ex: {{NAME}} sera remplacé par le nom de l'emoji)",
        type: OptionType.STRING,
        default: "{{NAME}}"
    },
    disableEmbedPermissionCheck: {
        displayName: "Ignorer la restriction des liens intégrés",
        description: "Permet d'envoyer des emojis même dans les salons où les intégrations de liens sont bloquées",
        type: OptionType.BOOLEAN,
        default: false
    },
    // ===== Exclusivités OmniFakeNitro =====
    customBannerUrl: {
        displayName: "Bannière personnalisée (Omni Studio)",
        description: "Héberge ton image ou GIF sur catbox.moe, puis colle ici le lien files.catbox.moe/… (seuls les liens Catbox ou Imgur sont visibles par les autres utilisateurs d'OmniFakeNitro)",
        type: OptionType.STRING,
        default: "",
        placeholder: "https://files.catbox.moe/...",
        onChange(val: string) {
            if (val?.includes("tenor.com") && !val.endsWith(".gif")) {
                Native.resolveTenorUrl(val).then(direct => {
                    if (direct && direct.endsWith(".gif")) {
                        settings.store.customBannerUrl = direct;
                    }
                }).catch(() => {});
            }
        }
    },
    customAvatarUrl: {
        displayName: "Avatar personnalisé (Omni Studio)",
        description: "Héberge ton image ou GIF sur catbox.moe, puis colle ici le lien files.catbox.moe/… (seuls les liens Catbox ou Imgur sont visibles par les autres utilisateurs d'OmniFakeNitro)",
        type: OptionType.STRING,
        default: "",
        placeholder: "https://files.catbox.moe/...",
        onChange(val: string) {
            if (val?.includes("tenor.com") && !val.endsWith(".gif")) {
                Native.resolveTenorUrl(val).then(direct => {
                    if (direct && direct.endsWith(".gif")) {
                        settings.store.customAvatarUrl = direct;
                    }
                }).catch(() => {});
            }
        }
    },
    enableOmniBadge: {
        displayName: "Badge officiel Soutien Omni",
        description: "Affiche le logo Omni 'Soutien Omni' directement sur votre profil",
        type: OptionType.BOOLEAN,
        default: true
    },
    enableProfileGlow: {
        displayName: "Aura Néon animée (Omni FX)",
        description: "Ajoute un halo lumineux néon qui pulse autour de votre carte de profil",
        type: OptionType.BOOLEAN,
        default: true,
        onChange(val: boolean) {
            val ? enableStyle(neonStyle) : disableStyle(neonStyle);
        }
    },
    neonColorPicker: {
        type: OptionType.COMPONENT,
        component: NeonColorPicker
    },
    neonColor: {
        type: OptionType.CUSTOM,
        default: DEFAULT_NEON_COLOR
    },
    shareProfile: {
        type: OptionType.COMPONENT,
        component: ShareOmniProfile
    },
    bigUploadExpiry: {
        displayName: "Durée d'expiration des gros fichiers",
        description: "Durée de conservation des fichiers envoyés avec le bouton de la barre de message",
        type: OptionType.SELECT,
        options: [
            { label: "1 heure", value: "1h" },
            { label: "12 heures", value: "12h" },
            { label: "24 heures", value: "24h" },
            { label: "72 heures (Recommandé)", value: "72h", default: true }
        ]
    }
});

function hasPermission(channelId: string, permission: bigint) {
    const channel = ChannelStore.getChannel(channelId);

    if (!channel || channel.isPrivate()) return true;

    return PermissionStore.can(permission, channel);
}

const hasExternalEmojiPerms = (channelId: string) => hasPermission(channelId, PermissionsBits.USE_EXTERNAL_EMOJIS);
const hasExternalStickerPerms = (channelId: string) => hasPermission(channelId, PermissionsBits.USE_EXTERNAL_STICKERS);
const hasEmbedPerms = (channelId: string) => hasPermission(channelId, PermissionsBits.EMBED_LINKS);
const hasAttachmentPerms = (channelId: string) => hasPermission(channelId, PermissionsBits.ATTACH_FILES);

// Applique fn uniquement au texte hors blocs ```code``` et `code` inline
function replaceOutsideCode(content: string, fn: (part: string) => string) {
    return content.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, i) => i % 2 ? part : fn(part)).join("");
}

function getWordBoundary(origStr: string, offset: number) {
    return (!origStr[offset] || /\s/.test(origStr[offset])) ? "" : " ";
}

function CannotEmbedNoticeModal({ modalProps, resolve }: { modalProps: RenderModalProps; resolve: (value: boolean) => void; }) {
    const s = settings.use(["disableEmbedPermissionCheck"]);
    return (
        <ConfirmModal
            {...modalProps}
            title="Attention !"
            subtitle="Vous essayez d'envoyer un message contenant un émoji ou sticker Nitro, mais l'intégration de liens est restreinte dans ce salon. Voulez-vous quand même l'envoyer ?"
            confirmText="Envoyer quand même"
            cancelText="Annuler"
            onConfirm={() => resolve(true)}
            onCloseCallback={() => setImmediate(() => resolve(false))}
            checkboxProps={{
                checked: s.disableEmbedPermissionCheck === true,
                onChange: checked => s.disableEmbedPermissionCheck = checked
            }}
        />
    );
}

function showCannotEmbedNotice() {
    return new Promise<boolean>(resolve => {
        openModal(props => <CannotEmbedNoticeModal modalProps={props} resolve={resolve} />);
    });
}

export default definePlugin({
    name: "OmniFakeNitro",
    // Basé sur FakeNitro de Vencord (GPL-3.0) - merci aux auteurs originaux
    authors: [Devs.Exprimes, Devs.Arjix, Devs.D3SOX, Devs.Ven, Devs.fawn, Devs.captain, Devs.Nuckyz, Devs.AutumnVN, Devs.sadan],
    description: "Le pack ultime OmniFakeNitro : Emojis/Stickers illimités, Streaming 1080p 60 FPS, Thèmes & Profils personnalisés, Aura Néon, et envoi de gros fichiers jusqu'à 1 Go.",

    chatBarButton: {
        icon: BigUploadIcon,
        render: makeBigUploadButton(() => settings.store.bigUploadExpiry ?? "72h")
    },
    tags: ["Emotes", "Appearance", "Customisation", "Chat"],
    dependencies: ["MessageEventsAPI"],

    settings,

    patches: [
        {
            find: "canUseCustomStickersEverywhere:",
            replacement: [
                {
                    match: /(?<=canUseCustomStickersEverywhere:function\(\i\)\{)/,
                    replace: "return true;",
                    predicate: () => settings.store.enableStickerBypass
                },
                {
                    match: /(?<=canUseHighVideoUploadQuality:function\(\i\)\{)/,
                    replace: "return true;",
                    predicate: () => settings.store.enableStreamQualityBypass
                },
                {
                    match: /(?<=canStreamQuality:function\(\i,\i\)\{)/,
                    replace: "return true;",
                    predicate: () => settings.store.enableStreamQualityBypass
                },
                {
                    match: /(?<=canUseClientThemes:function\(\i\)\{)/,
                    replace: "return true;"
                },
                {
                    match: /(?<=canUsePremiumAppIcons:function\(\i\)\{)/,
                    replace: "return true;"
                }
            ],
        },
        // Patch the emoji picker in voice calls to not be bypassed by fake nitro
        {
            find: '.getByName("fork_and_knife")',
            predicate: () => settings.store.enableEmojiBypass,
            replacement: {
                match: ".CHAT",
                replace: ".STATUS"
            }
        },
        {
            find: ".GUILD_SUBSCRIPTION_UNAVAILABLE;",
            group: true,
            predicate: () => settings.store.enableEmojiBypass,
            replacement: [
                {
                    // Create a variable for the intention of using the emoji
                    match: /(?<=\.USE_EXTERNAL_EMOJIS.+?;)(?<=intention:(\i).+?)/,
                    replace: (_, intention) => `const fakeNitroIntention=${intention};`
                },
                {
                    // Disallow the emoji for external if the intention doesn't allow it
                    match: /&&!\i&&!\i(?=\)return \i\.\i\.DISALLOW_EXTERNAL;)/,
                    replace: m => `${m}&&!${IS_BYPASSEABLE_INTENTION}`
                },
                {
                    // Disallow the emoji for unavailable if the intention doesn't allow it
                    match: /!\i\.available(?=\)return \i\.\i\.GUILD_SUBSCRIPTION_UNAVAILABLE;)/,
                    replace: m => `${m}&&!${IS_BYPASSEABLE_INTENTION}`
                },
                {
                    // Disallow the emoji for premium locked if the intention doesn't allow it
                    match: /(?<=!\(\i\|\|)\i\.\i\.canUseEmojisEverywhere\(\i\)/,
                    replace: check => `(${check}||${IS_BYPASSEABLE_INTENTION})`
                },
                {
                    // Allow animated emojis to be used if the intention allows it
                    match: /(?<=\|\|)\i\.\i\.canUseAnimatedEmojis\(\i\)/,
                    replace: m => `(${m}||${IS_BYPASSEABLE_INTENTION})`
                }
            ]
        },
        // Allows the usage of subscription-locked emojis
        {
            find: ".getUserIsAdmin(",
            replacement: {
                match: /(function \i\(\i,\i)\){(.{0,250}.getUserIsAdmin\(.+?return!1})/,
                replace: (_, rest1, rest2) => `${rest1},fakeNitroOriginal){if(!fakeNitroOriginal)return false;${rest2}`
            }
        },
        // Make stickers always available
        {
            find: '"SENDABLE"',
            predicate: () => settings.store.enableStickerBypass,
            replacement: {
                match: /\i\.available\?/,
                replace: "true?"
            }
        },
        // Remove boost requirements to stream with high quality
        {
            find: "#{intl::STREAM_FPS_OPTION}",
            predicate: () => settings.store.enableStreamQualityBypass,
            replacement: {
                match: /guildPremiumTier:\i\.\i\.TIER_\d,?/g,
                replace: ""
            }
        },
        {
            find: '"UserSettingsProtoStore"',
            replacement: [
                {
                    // Overwrite incoming connection settings proto with our local settings
                    match: /(?<=CONNECTION_OPEN:function\((\i)\){)/,
                    replace: (_, props) => `$self.handleProtoChange(${props}.userSettingsProto,${props}.user);`
                },
                {
                    // Overwrite non local proto changes with our local settings
                    match: /let{settings:/,
                    replace: "arguments[0].local||$self.handleProtoChange(arguments[0].settings.proto);$&"
                }
            ]
        },
        // Call our function to handle changing the gradient theme when selecting a new one
        {
            find: ",updateTheme(",
            replacement: {
                match: /(function \i\(\i\){let{backgroundGradientPresetId:(\i).+?)(\i\.\i\.updateAsync.+?theme=(.+?),.+?},\i\))/,
                replace: (_, rest, backgroundGradientPresetId, originalCall, theme) => `${rest}$self.handleGradientThemeSelect(${backgroundGradientPresetId},${theme},()=>${originalCall});`
            }
        },
        // Allow users to use custom client themes
        {
            find: ".CLIENT_THEMES_EDITOR?",
            replacement: {
                match: /(?<=\i=)\(0,\i\.\i\)\(\i\.\i\.TIER_2\)(?=,|;)/g,
                replace: "true"
            }
        },
        {
            find: '["strong","em","u","text","inlineCode","s","spoiler"]',
            predicate: () => settings.store.transformEmojis || settings.store.transformStickers,
            replacement: {
                match: /\(\{ast:(\i)(?=,inline:\i)/,
                replace: "({ast:$self.transformAst($1)"
            }
        },
        {
            find: "}renderStickersAccessories(",
            replacement: [
                {
                    // Call our function to decide whether the embed should be ignored or not
                    predicate: () => settings.store.transformEmojis || settings.store.transformStickers,
                    match: /(renderEmbeds\((\i)\){)(.+?embeds\.map\(\((\i),\i\)?=>{)/,
                    replace: (_, rest1, message, rest2, embed) => `${rest1}const fakeNitroMessage=${message};${rest2}if($self.shouldIgnoreEmbed(${embed},fakeNitroMessage))return null;`
                },
                {
                    // Patch the stickers array to add fake nitro stickers
                    predicate: () => settings.store.transformStickers,
                    match: /renderStickersAccessories\((\i)\){let (\i)=\(0,\i\.\i\)\(\i\).+?;/,
                    replace: (m, message, stickers) => `${m}${stickers}=$self.patchFakeNitroStickers(${stickers},${message});`
                },
                {
                    // Filter attachments to remove fake nitro stickers or emojis
                    predicate: () => settings.store.transformStickers,
                    match: /renderAttachments\(\i\){.+?{attachments:(\i).+?;/,
                    replace: (m, attachments) => `${m}${attachments}=$self.filterAttachments(${attachments});`
                }
            ]
        },
        {
            find: "#{intl::STICKER_POPOUT_UNJOINED_PRIVATE_GUILD_DESCRIPTION}",
            predicate: () => settings.store.transformStickers,
            replacement: [
                {
                    // Export the renderable sticker to be used in the fake nitro sticker notice
                    match: /let{renderableSticker:(\i).{0,270}sticker:\i,channel:\i,/,
                    replace: (m, renderableSticker) => `${m}fakeNitroRenderableSticker:${renderableSticker},`
                },
                {
                    // Add the fake nitro sticker notice
                    match: /(let \i,{sticker:\i,channel:\i,closePopout:\i.+?}=(\i).+?;)(.+?description:)(\i)(?=,sticker:\i)/,
                    replace: (_, rest, props, rest2, reactNode) => `${rest}let{fakeNitroRenderableSticker}=${props};${rest2}$self.addFakeNotice(${FakeNoticeType.Sticker},${reactNode},!!fakeNitroRenderableSticker?.fake)`
                }
            ]
        },
        {
            find: ".EMOJI_UPSELL_POPOUT_MORE_EMOJIS_OPENED,",
            predicate: () => settings.store.transformEmojis,
            replacement: {
                // Export the emoji node to be used in the fake nitro emoji notice
                match: /isDiscoverable:\i,shouldHideRoleSubscriptionCTA:\i,(?<={node:(\i),.+?)/,
                replace: (m, node) => `${m}fakeNitroNode:${node},`
            }
        },
        {
            find: "#{intl::EMOJI_POPOUT_UNJOINED_DISCOVERABLE_GUILD_DESCRIPTION}",
            predicate: () => settings.store.transformEmojis,
            replacement: {
                // Add the fake nitro emoji notice
                match: /(?<=emojiDescription:)(\i)(?<=\1=function\(\i\)\{let\{sourceType:.+?)/,
                replace: (_, reactNode) => `$self.addFakeNotice(${FakeNoticeType.Emoji},${reactNode},!!arguments[0]?.fakeNitroNode?.fake)`
            }
        },
        // Separate patch for allowing using custom app icons
        {
            find: "getCurrentDesktopIcon(),",
            replacement: {
                match: /\i\.\i\.isPremium\(\i\.\i\.getCurrentUser\(\)\)/,
                replace: "true"
            }
        },
        // Make all Soundboard sounds available
        {
            find: 'type:"GUILD_SOUNDBOARD_SOUND_CREATE"',
            replacement: {
                match: /(?<=type:"(?:SOUNDBOARD_SOUNDS_RECEIVED|GUILD_SOUNDBOARD_SOUND_CREATE|GUILD_SOUNDBOARD_SOUND_UPDATE|GUILD_SOUNDBOARD_SOUNDS_UPDATE)".+?available:)\i\.available/g,
                replace: "true"
            }
        },
        // Patch banner to display custom banner URL
        {
            find: ':"SHOULD_LOAD");',
            replacement: {
                match: /\i(?:\?)?.getPreviewBanner\(\i,\i,\i\)(?=.{0,100}"COMPLETE")/,
                replace: "$self.patchBannerUrl(arguments[0])||$&"
            }
        }
    ],

    get guildId() {
        return getCurrentGuild()?.id;
    },

    get canUseEmotes() {
        return (UserStore.getCurrentUser().premiumType ?? 0) > 0;
    },

    get canUseStickers() {
        return (UserStore.getCurrentUser().premiumType ?? 0) > 1;
    },

    handleProtoChange(proto: any, user: any) {
        try {
            if (proto == null || typeof proto === "string") return;

            const premiumType: number = user?.premium_type ?? UserStore?.getCurrentUser()?.premiumType ?? 0;

            if (premiumType !== 2) {
                proto.appearance ??= AppearanceSettingsActionCreators.create();

                const protoStoreAppearenceSettings = UserSettingsProtoStore.settings.appearance;

                const appearanceSettingsOverwrite = AppearanceSettingsActionCreators.create({
                    ...proto.appearance,
                    theme: protoStoreAppearenceSettings?.theme,
                    clientThemeSettings: protoStoreAppearenceSettings?.clientThemeSettings
                });

                proto.appearance = appearanceSettingsOverwrite;
            }
        } catch (err) {
            new Logger("FakeNitro").error(err);
        }
    },

    handleGradientThemeSelect(backgroundGradientPresetId: number | undefined, theme: number, original: () => void) {
        const premiumType = UserStore?.getCurrentUser()?.premiumType ?? 0;
        if (premiumType === 2 || backgroundGradientPresetId == null) return original();

        if (!PreloadedUserSettingsActionCreators || !AppearanceSettingsActionCreators || !ClientThemeSettingsActionsCreators || !BINARY_READ_OPTIONS) return;

        const currentAppearanceSettings = PreloadedUserSettingsActionCreators.getCurrentValue().appearance;

        const newAppearanceProto = currentAppearanceSettings != null
            ? AppearanceSettingsActionCreators.fromBinary(AppearanceSettingsActionCreators.toBinary(currentAppearanceSettings), BINARY_READ_OPTIONS)
            : AppearanceSettingsActionCreators.create();

        newAppearanceProto.theme = theme;

        const clientThemeSettingsDummy = ClientThemeSettingsActionsCreators.create({
            backgroundGradientPresetId: {
                value: backgroundGradientPresetId
            }
        });

        newAppearanceProto.clientThemeSettings ??= clientThemeSettingsDummy;
        newAppearanceProto.clientThemeSettings.backgroundGradientPresetId = clientThemeSettingsDummy.backgroundGradientPresetId;

        const proto = PreloadedUserSettingsActionCreators.ProtoClass.create();
        proto.appearance = newAppearanceProto;

        FluxDispatcher.dispatch({
            type: "USER_SETTINGS_PROTO_UPDATE",
            local: true,
            partial: true,
            settings: {
                type: 1,
                proto
            }
        });
    },

    trimContent(content: Array<any>) {
        const firstContent = content[0];
        if (typeof firstContent === "string") {
            content[0] = firstContent.trimStart();
            content[0] || content.shift();
        } else if (typeof firstContent?.props?.children === "string") {
            firstContent.props.children = firstContent.props.children.trimStart();
            firstContent.props.children || content.shift();
        }

        const lastIndex = content.length - 1;
        const lastContent = content[lastIndex];
        if (typeof lastContent === "string") {
            content[lastIndex] = lastContent.trimEnd();
            content[lastIndex] || content.pop();
        } else if (typeof lastContent?.props?.children === "string") {
            lastContent.props.children = lastContent.props.children.trimEnd();
            lastContent.props.children || content.pop();
        }
    },

    clearEmptyArrayItems(array: Array<any>) {
        return array.filter(item => item != null);
    },

    ensureChildrenIsArray(child: ReactElement<any>) {
        if (!Array.isArray(child.props.children)) child.props.children = [child.props.children];
    },

    transformAst(ast: any[]) {
        try {
            if (!settings.store.transformCompoundSentence && ast.length > 1) {
                return ast;
            }
            // Filter out sticker links. These are transformed into actual stickers later, so we don't want duplicate links
            if (settings.store.transformStickers) {
                ast = ast.filter(node => {
                    const { type, target } = node;

                    if (type !== "link") return true;
                    if (fakeNitroStickerRegex.test(target)) return false;

                    const gifStickerLinkMatch = target.match(fakeNitroGifStickerRegex);
                    const isGifStickerLink = gifStickerLinkMatch && StickersStore.getStickerById(gifStickerLinkMatch[1]);

                    return !isGifStickerLink;
                });
            }

            if (settings.store.transformEmojis) {
                ast = ast.map(node => {
                    const { type, target } = node;

                    if (type !== "link") return node;

                    const fakeNitroMatch = target.match(fakeNitroEmojiRegex);
                    if (!fakeNitroMatch) return node;

                    let url: URL | null = null;
                    try {
                        url = new URL(target);
                    } catch { }

                    const emojiId = fakeNitroMatch[1];
                    const emojiName = EmojiStore.getCustomEmojiById(emojiId)?.name ?? url?.searchParams.get("name") ?? "FakeNitroEmoji";
                    const animated = fakeNitroMatch[2] === "gif" || url?.searchParams.get("animated") === "true";

                    return {
                        animated,
                        emojiId,
                        name: `:${emojiName}:`,
                        type: "customEmoji",
                        fake: true
                    };
                });
            }
        } catch (e) {
            logger.error("Error transforming AST:", e);
        }

        return ast;
    },

    patchFakeNitroStickers(stickers: Array<any>, message: Message) {
        const itemsToMaybePush: Array<string> = [];

        const contentItems = message.content.split(/\s/);
        if (settings.store.transformCompoundSentence) itemsToMaybePush.push(...contentItems);
        else if (contentItems.length === 1) itemsToMaybePush.push(contentItems[0]);
        else if (hyperLinkOnlyRegex.test(message.content)) itemsToMaybePush.push(message.content);

        itemsToMaybePush.push(...message.attachments.filter(attachment => attachment.content_type === "image/gif").map(attachment => attachment.url));

        for (const item of itemsToMaybePush) {
            if (!settings.store.transformCompoundSentence && !item.startsWith("http") && !hyperLinkRegex.test(item)) continue;

            const imgMatch = item.match(fakeNitroStickerRegex);
            if (imgMatch) {
                let url: URL | null = null;
                try {
                    url = new URL(item);
                } catch { }

                const stickerName = StickersStore.getStickerById(imgMatch[1])?.name ?? url?.searchParams.get("name") ?? "FakeNitroSticker";
                stickers.push({
                    format_type: 1,
                    id: imgMatch[1],
                    name: stickerName,
                    fake: true
                });

                continue;
            }

            const gifMatch = item.match(fakeNitroGifStickerRegex);
            if (gifMatch) {
                if (!StickersStore.getStickerById(gifMatch[1])) continue;

                const stickerName = StickersStore.getStickerById(gifMatch[1])?.name ?? "FakeNitroSticker";
                stickers.push({
                    format_type: 2,
                    id: gifMatch[1],
                    name: stickerName,
                    fake: true
                });
            }
        }

        return stickers;
    },

    shouldIgnoreEmbed(embed: Message["embeds"][number], message: Message) {
        try {
            const contentItems = message.content.split(/\s/);
            if (contentItems.length > 1 && !settings.store.transformCompoundSentence && !hyperLinkOnlyRegex.test(message.content)) return false;

            switch (embed.type) {
                case "image": {
                    const url = embed.url ?? embed.image?.url;
                    if (!url) return false;
                    if (
                        !settings.store.transformCompoundSentence
                        && !contentItems.some(item => item === url || item.match(hyperLinkRegex)?.[1] === url)
                        && !hyperLinkOnlyRegex.test(message.content)
                    ) return false;

                    if (settings.store.transformEmojis) {
                        if (fakeNitroEmojiRegex.test(url)) return true;
                    }

                    if (settings.store.transformStickers) {
                        if (fakeNitroStickerRegex.test(url)) return true;

                        const gifMatch = url.match(fakeNitroGifStickerRegex);
                        if (gifMatch) {
                            // There is no way to differentiate a regular gif attachment from a fake nitro animated sticker, so we check if the StickersStore contains the id of the fake sticker
                            if (StickersStore.getStickerById(gifMatch[1])) return true;
                        }
                    }

                    break;
                }
            }
        } catch (e) {
            new Logger("FakeNitro").error("Error in shouldIgnoreEmbed:", e);
        }

        return false;
    },

    filterAttachments(attachments: Message["attachments"]) {
        return attachments.filter(attachment => {
            if (attachment.content_type !== "image/gif") return true;

            const match = attachment.url.match(fakeNitroGifStickerRegex);
            if (match) {
                // There is no way to differentiate a regular gif attachment from a fake nitro animated sticker, so we check if the StickersStore contains the id of the fake sticker
                if (StickersStore.getStickerById(match[1])) return false;
            }

            return true;
        });
    },

    addFakeNotice(type: FakeNoticeType, node: Array<ReactNode>, fake: boolean) {
        if (!fake) return node;

        node = Array.isArray(node) ? node : [node];

        switch (type) {
            case FakeNoticeType.Sticker: {
                node.push(" This is a FakeNitro sticker and renders like a real sticker only for you. Appears as a link to non-plugin users.");

                return node;
            }
            case FakeNoticeType.Emoji: {
                node.push(" This is a FakeNitro emoji and renders like a real emoji only for you. Appears as a link to non-plugin users.");

                return node;
            }
        }
    },

    getStickerLink({ format_type, id }: Sticker) {
        const ext = format_type === StickerFormatType.GIF ? "gif" : "png";
        return `https://media.discordapp.net/stickers/${id}.${ext}?size=${settings.store.stickerSize}`;
    },

    async sendAnimatedSticker(stickerLink: string, stickerId: string, channelId: string) {

        const { frames, width, height } = await fetch(stickerLink)
            .then(res => res.arrayBuffer())
            .then(parseAPNG);

        const gif = GIFEncoder();
        const resolution = settings.store.stickerSize ?? DEFAULT_STICKER_SIZE;

        const canvas = document.createElement("canvas");
        canvas.width = resolution;
        canvas.height = resolution;

        const ctx = canvas.getContext("2d", {
            willReadFrequently: true
        })!;

        const scale = resolution / Math.max(width, height);
        ctx.scale(scale, scale);

        let previousFrameData: ImageData;

        for (const frame of frames) {
            const { left, top, width, height, img, delay, blendOp, disposeOp } = frame;

            previousFrameData = ctx.getImageData(left, top, width, height);

            if (blendOp === ApngBlendOp.SOURCE) {
                ctx.clearRect(left, top, width, height);
            }

            ctx.drawImage(img, left, top, width, height);

            const { data } = ctx.getImageData(0, 0, resolution, resolution);

            const palette = quantize(data, 256);
            const index = applyPalette(data, palette);

            gif.writeFrame(index, resolution, resolution, {
                transparent: true,
                palette,
                delay
            });

            if (disposeOp === ApngDisposeOp.BACKGROUND) {
                ctx.clearRect(left, top, width, height);
            } else if (disposeOp === ApngDisposeOp.PREVIOUS) {
                ctx.putImageData(previousFrameData, left, top);
            }
        }

        gif.finish();

        const file = new File([gif.bytesView() as Uint8Array<ArrayBuffer>], `${stickerId}.gif`, { type: "image/gif" });
        UploadHandler.promptToUpload([file], ChannelStore.getChannel(channelId), DraftType.ChannelMessage);
    },

    // Discord envoie lui-même les fichiers de attachmentsToUpload avec le message, le texte de la barre est donc bien vidé
    async moveLinksToAttachments(channelId: string, messageObj: { content: string; }, options: object, links: { text: string; url: string; name: string; }[]) {
        const files = await Promise.all(links.map(async ({ url, name }) => {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
            const blob = await res.blob();
            return new File([blob], `${name.replace(/\W/g, "_")}.${new URL(url).pathname.split(".").pop()}`, { type: blob.type });
        }));

        Object.assign(options, {
            attachmentsToUpload: files.map(file => new CloudUpload({ file, isThumbnail: false, platform: CloudUploadPlatform.WEB }, channelId))
        });
        for (const { text } of links) messageObj.content = messageObj.content.replace(text, "");
        messageObj.content = messageObj.content.trim();
    },

    canUseEmote(e: Emoji, channelId: string) {
        if (e.type === 0) return true;
        if (e.available === false) return false;

        if (isUnusableRoleSubscriptionEmoji(e, this.guildId, true)) return false;

        let isUsableTwitchSubEmote = false;
        if (e.managed && e.guildId) {
            const myRoles = GuildMemberStore.getSelfMember(e.guildId)?.roles ?? [];
            isUsableTwitchSubEmote = e.roles.some(r => myRoles.includes(r));
        }

        if (this.canUseEmotes || isUsableTwitchSubEmote)
            return e.guildId === this.guildId || hasExternalEmojiPerms(channelId);
        else
            return !e.animated && e.guildId === this.guildId;
    },

    origGetAvatarURL: null as any,
    origIconUtils: null as any,
    origGetProfile: null as any,

    patchBannerUrl({ displayProfile }: any) {
        const myId = UserStore.getCurrentUser()?.id;
        const uid = displayProfile?.userId ?? displayProfile?.id ?? displayProfile?.user?.id;
        if ((!uid || uid === myId) && settings.store.customBannerUrl) {
            return cleanMediaUrl(settings.store.customBannerUrl);
        }
        if (uid && uid !== myId) return othersOmniProfile(uid)?.banner;
    },

    hookAvatar() {
        const currentUser = UserStore.getCurrentUser();
        if (currentUser) {
            const proto = Object.getPrototypeOf(currentUser);
            if (proto?.getAvatarURL && !this.origGetAvatarURL) {
                this.origGetAvatarURL = proto.getAvatarURL;
                const orig = this.origGetAvatarURL;
                proto.getAvatarURL = function (guildId?: string, size?: number, canAnimate?: boolean) {
                    if (isMe(this.id)) {
                        if (settings.store.customAvatarUrl) return cleanMediaUrl(settings.store.customAvatarUrl);
                    } else {
                        const avatar = othersOmniProfile(this.id)?.avatar;
                        if (avatar) return avatar;
                    }
                    return orig.call(this, guildId, size, canAnimate);
                };
            }
        }
    },

    flux: {
        CONNECTION_OPEN() {
            (this as any).hookAvatar();
        }
    },

    start() {
        const s = settings.store;

        // Les deux plugins patchent le même code Discord : on coupe FakeNitro (pris en compte au prochain redémarrage)
        if (isPluginEnabled("FakeNitro")) {
            Settings.plugins.FakeNitro.enabled = false;
            showToast({ text: "FakeNitro a été désactivé (doublon d'OmniFakeNitro). Redémarre Discord.", variant: "critical" });
        }

        // Omni VIP Badge & Aura Neon
        addProfileBadge(omniBadge);
        applyNeonColor();
        if (s.enableProfileGlow) {
            enableStyle(neonStyle);
        }

        this.hookAvatar();

        if (IconUtils && !this.origIconUtils) {
            this.origIconUtils = (IconUtils as any).getUserAvatarURL;
            if (this.origIconUtils) {
                const origIcon = this.origIconUtils;
                (IconUtils as any).getUserAvatarURL = function (user: any, ...args: any[]) {
                    if (isMe(user?.id)) {
                        if (settings.store.customAvatarUrl) return cleanMediaUrl(settings.store.customAvatarUrl);
                    } else if (user?.id) {
                        const avatar = othersOmniProfile(user.id)?.avatar;
                        if (avatar) return avatar;
                    }
                    return origIcon.call(this, user, ...args);
                };
            }
        }

        if (UserProfileStore && !this.origGetProfile) {
            this.origGetProfile = rawGetProfile = UserProfileStore.getUserProfile;
            const self = this;
            UserProfileStore.getUserProfile = function (userId: string) {
                const profile = self.origGetProfile.call(this, userId);
                if (!profile) return profile;

                const bannerUrl = isMe(userId)
                    ? settings.store.customBannerUrl && cleanMediaUrl(settings.store.customBannerUrl)
                    : othersOmniProfile(userId)?.banner;
                if (bannerUrl) {
                    profile.banner = "omni_banner";
                    profile.getBannerURL = () => bannerUrl;
                    profile.getPreviewBanner = () => bannerUrl;
                }
                if (isMe(userId)) profile.themeColors ??= [0xa855f7, 0x1e1b4b];
                return profile;
            };
        }

        if (!s.enableEmojiBypass && !s.enableStickerBypass) {
            return;
        }

        this.preSend = addMessagePreSendListener(async (channelId, messageObj, options, props) => {
            const { guildId } = this;

            let hasBypass = false;
            const links: { text: string; url: string; name: string; }[] = [];
            const makeLink = (url: URL | string, name: string) => {
                const text = s.useHyperLinks ? `[${s.hyperLinkText.replaceAll("{{NAME}}", name)}](${url})` : `${url}`;
                links.push({ text, url: `${url}`, name });
                return text;
            };

            stickerBypass: {
                if (!s.enableStickerBypass)
                    break stickerBypass;

                const sticker = StickersStore.getStickerById(options.stickerIds?.[0]!);
                if (!sticker)
                    break stickerBypass;

                // Discord Stickers are now free yayyy!! :D
                if ("pack_id" in sticker)
                    break stickerBypass;

                const canUseStickers = this.canUseStickers && hasExternalStickerPerms(channelId);
                if (sticker.available !== false && (canUseStickers || sticker.guild_id === guildId))
                    break stickerBypass;

                const link = this.getStickerLink(sticker);

                if (sticker.format_type === StickerFormatType.APNG) {
                    if (!hasAttachmentPerms(channelId)) {
                        openModal(props => (
                            <ConfirmModal
                                {...props}
                                title="Attention !"
                                confirmText="D'accord"
                                variant="primary"
                            >
                                <div>
                                    <Paragraph>
                                        Vous ne pouvez pas envoyer cet autocollant animé car vous n'avez pas la permission de joindre des fichiers dans ce salon.
                                    </Paragraph>
                                </div>
                            </ConfirmModal>
                        ));
                    } else {
                        this.sendAnimatedSticker(link, sticker.id, channelId);
                    }

                    return { cancel: true };
                } else {
                    hasBypass = true;

                    const url = new URL(link);
                    url.searchParams.set("name", sticker.name);
                    url.searchParams.set("lossless", "true");

                    messageObj.content += `${getWordBoundary(messageObj.content, messageObj.content.length - 1)}${makeLink(url, sticker.name)}`;
                    options.stickerIds!.length = 0;
                }
            }

            if (s.enableEmojiBypass) {
                for (const emoji of messageObj.validNonShortcutEmojis) {
                    if (this.canUseEmote(emoji, channelId)) continue;

                    hasBypass = true;

                    const emojiSize = s.emojiSize ?? DEFAULT_EMOJI_SIZE;
                    const emojiString = `<${emoji.animated ? "a" : ""}:${emoji.originalName || emoji.name}:${emoji.id}>`;

                    const url = new URL(IconUtils.getEmojiURL({ id: emoji.id, animated: emoji.animated, size: emojiSize }));
                    url.searchParams.set("size", emojiSize.toString());
                    url.searchParams.set("name", emoji.name);
                    url.searchParams.set("lossless", "true");

                    messageObj.content = messageObj.content.replace(emojiString, (match, offset, origStr) => {
                        return `${getWordBoundary(origStr, offset - 1)}${makeLink(url, emoji.name)}${getWordBoundary(origStr, offset + match.length)}`;
                    });
                }

                // Remplacement des balises Discord directes <a:name:id> ou <:name:id> (hors code, hors \échappées)
                messageObj.content = replaceOutsideCode(messageObj.content, part => part.replace(/(?<!\\)<(a?):([a-zA-Z0-9_]+):(\d+)>/g, (match, animated, emojiName, emojiId) => {
                    const known = EmojiStore.getCustomEmojiById(emojiId);
                    if (known && this.canUseEmote(known, channelId)) return match;
                    hasBypass = true;
                    const emojiSize = s.emojiSize ?? DEFAULT_EMOJI_SIZE;
                    const ext = animated ? "gif" : "webp";
                    const url = `https://cdn.discordapp.com/emojis/${emojiId}.${ext}?size=${emojiSize}&quality=lossless`;
                    return `${makeLink(url, emojiName)}${s.useHyperLinks ? "" : " "}`;
                }));

                // Remplacement universel de tout code :nom_emoji: laissé en texte brut (hors code, hors \échappés)
                messageObj.content = replaceOutsideCode(messageObj.content, part => part.replace(/(?<!\\|<|<a):([a-zA-Z0-9_]{2,}):/g, (match, emojiName) => {
                    const found = findCustomEmojiByName(emojiName);
                    if (found) {
                        hasBypass = true;
                        const ext = found.animated ? "gif" : "webp";
                        const emojiSize = s.emojiSize ?? DEFAULT_EMOJI_SIZE;
                        const url = `https://cdn.discordapp.com/emojis/${found.id}.${ext}?size=${emojiSize}&quality=lossless`;
                        return `${makeLink(url, found.name)}${s.useHyperLinks ? "" : " "}`;
                    }
                    return match;
                }));
            }

            // Avec des fichiers déjà joints, Discord passe par un autre chemin d'envoi : on garde les liens.
            // shortcut: au-delà de 10 fichiers (limite Discord) tout reste en liens, à découper si ça gêne.
            if (s.hideEmojiLinks && links.length && links.length <= 10 && !props.hasAttachments && hasAttachmentPerms(channelId)) {
                try {
                    await this.moveLinksToAttachments(channelId, messageObj, options, links);
                    hasBypass = false;
                } catch (e) {
                    logger.error("Impossible de joindre les emojis, envoi avec des liens :", e);
                }
            }

            if (hasBypass && !s.disableEmbedPermissionCheck && !hasEmbedPerms(channelId)) {
                if (!await showCannotEmbedNotice()) {
                    return { cancel: true };
                }
            }

            return { cancel: false };
        });

        this.preEdit = addMessagePreEditListener(async (channelId, __, messageObj) => {
            if (!s.enableEmojiBypass) return;

            let hasBypass = false;

            messageObj.content = messageObj.content.replace(/(?<!\\)<a?:(?:\w+):(\d+)>/ig, (emojiStr, emojiId, offset, origStr) => {
                const emoji = EmojiStore.getCustomEmojiById(emojiId);
                if (emoji == null) return emojiStr;
                if (this.canUseEmote(emoji, channelId)) return emojiStr;

                hasBypass = true;

                const emojiSize = s.emojiSize ?? DEFAULT_EMOJI_SIZE;

                const url = new URL(IconUtils.getEmojiURL({ id: emoji.id, animated: emoji.animated, size: emojiSize }));
                url.searchParams.set("size", emojiSize.toString());
                url.searchParams.set("name", emoji.name);
                url.searchParams.set("lossless", "true");

                const linkText = s.hyperLinkText.replaceAll("{{NAME}}", emoji.name);

                return `${getWordBoundary(origStr, offset - 1)}${s.useHyperLinks ? `[${linkText}](${url})` : url}${getWordBoundary(origStr, offset + emojiStr.length)}`;
            });

            if (hasBypass && !s.disableEmbedPermissionCheck && !hasEmbedPerms(channelId)) {
                if (!await showCannotEmbedNotice()) {
                    return { cancel: true };
                }
            }

            return { cancel: false };
        });
    },

    stop() {
        removeProfileBadge(omniBadge);
        disableStyle(neonStyle);
        neonColorStyle.remove();
        if (this.origGetAvatarURL) {
            const currentUser = UserStore.getCurrentUser();
            if (currentUser) {
                const proto = Object.getPrototypeOf(currentUser);
                proto.getAvatarURL = this.origGetAvatarURL;
                this.origGetAvatarURL = null;
            }
        }
        if (this.origIconUtils && IconUtils) {
            (IconUtils as any).getUserAvatarURL = this.origIconUtils;
            this.origIconUtils = null;
        }
        if (this.origGetProfile && UserProfileStore) {
            UserProfileStore.getUserProfile = this.origGetProfile;
            this.origGetProfile = rawGetProfile = null;
        }
        removeMessagePreSendListener(this.preSend);
        removeMessagePreEditListener(this.preEdit);
    }
});
