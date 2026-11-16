/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025-2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Notices } from "@api/index";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import definePlugin from "@utils/types";
import { findStoreLazy } from "@webpack";
import { Alerts, ChannelStore, FluxDispatcher, GuildChannelStore, RestAPI, showToast } from "@webpack/common";

const QuestsStore = findStoreLazy("QuestStore");
const ApplicationStreamingStore = findStoreLazy("ApplicationStreamingStore");
const RunningGameStore = findStoreLazy("RunningGameStore");

const supportedTasks = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE"];

export default definePlugin({
    name: "QuestCompleter",
    description: "Completes Quests automatically in sequence",
    authors: [{ name: "Mr_PanoZzz", id: 939129546551210056n }],
    patches: [
        {
            find: "useMemo(()=>({sortMethod:",
            replacement: {
                match: /children:\[(.{0,30}optionClassName)/,
                replace: "children:[$self.CompleteQuestButton()(), $1"
            }
        }
    ],
    async completeQuest() {
        const quests = [...QuestsStore.quests.values()]
            .filter(
                x => x.userStatus?.enrolledAt &&
                    !x.userStatus?.completedAt &&
                    new Date(x.config.expiresAt).getTime() > Date.now() &&
                    supportedTasks.some(y => Object.keys((x.config.taskConfig ?? x.config.taskConfigV2).tasks).includes(y))
            )
            .reverse();

        const possibleQuest = quests[0];
        if (!possibleQuest) {
            return showToast("You don't have any uncompleted supported quests", 2);
        }

        const queueText = quests.length > 1
            ? ` (plus ${quests.length - 1} more queued after it)`
            : "";

        Alerts.show({
            title: "Confirm Quest Completion",
            body: (
                <BaseText>
                    Do you want to automatically complete the "{possibleQuest.config.messages.questName}" quest{queueText}?
                </BaseText>
            ),
            cancelText: "Cancel",
            confirmText: "OK",
            onConfirm: () => this.runQuestJob(quests)
        });
    },

    runQuestJob(quests: any[]) {
        const quest = quests.shift();
        if (!quest) {
            Notices.showNotice("All queued quests completed!", "OK", () => Notices.popNotice());
            showToast("All queued quests completed!", 1);
            return;
        }

        const pid = Math.floor(Math.random() * 30000) + 1000;
        const questName = quest.config.messages.questName;
        const taskConfig = quest.config.taskConfig ?? quest.config.taskConfigV2;
        const taskName = supportedTasks.find(x => taskConfig.tasks[x] != null)!;
        const taskData = taskConfig.tasks[taskName];
        const applicationId = quest.config.application?.id ?? taskData.applications?.[0]?.id;
        const secondsNeeded = taskData.target;
        let secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0;

        if (taskName === "WATCH_VIDEO" || taskName === "WATCH_VIDEO_ON_MOBILE") {
            const speed = 7;
            let completed = false;

            const fn = async () => {
                try {
                    while (true) {
                        const remaining = Math.min(speed, secondsNeeded - secondsDone);
                        await new Promise(resolve => setTimeout(resolve, remaining * 1000));

                        const timestamp = secondsDone + speed;
                        const res = await RestAPI.post({
                            url: `/quests/${quest.id}/video-progress`,
                            body: { timestamp: Math.min(secondsNeeded, timestamp + Math.random()) }
                        });

                        completed = res.body.completed_at != null;
                        secondsDone = Math.min(secondsNeeded, timestamp);

                        if (timestamp >= secondsNeeded) break;
                    }

                    if (!completed) {
                        await RestAPI.post({
                            url: `/quests/${quest.id}/video-progress`,
                            body: { timestamp: secondsNeeded }
                        });
                    }

                    showToast(`Completed: ${questName}`, 1);
                    setTimeout(() => this.runQuestJob(quests), 1500);
                } catch (err) {
                    showToast(`Video quest error: ${err}`, 2);
                    console.error("[QuestCompleter]", err);
                }
            };

            fn();
            showToast(`Spoofing video for ${questName}...`, 0);
        } else if (taskName === "PLAY_ON_DESKTOP") {
            RestAPI.get({ url: `/applications/public?application_ids=${applicationId}` }).then(res => {
                const appData = res.body[0];
                const exeName = appData.executables?.find((x: any) => x.os === "win32")?.name?.replace(">", "") ?? appData.name.replace(/[\/\\:*?"<>|]/g, "");

                const fakeGame = {
                    cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
                    exeName,
                    exePath: `c:/program files/${appData.name.toLowerCase()}/${exeName}`,
                    hidden: false,
                    isLauncher: false,
                    id: applicationId,
                    name: appData.name,
                    pid,
                    pidPath: [pid],
                    processName: appData.name,
                    start: Date.now(),
                };

                const realGames = RunningGameStore.getRunningGames();
                const fakeGames = [fakeGame];
                const realGetRunningGames = RunningGameStore.getRunningGames;
                const realGetGameForPID = RunningGameStore.getGameForPID;

                RunningGameStore.getRunningGames = () => fakeGames;
                RunningGameStore.getGameForPID = (p: number) => fakeGames.find(x => x.pid === p);
                FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: realGames, added: [fakeGame], games: fakeGames });

                const fn = (data: any) => {
                    if (data.questId && data.questId !== quest.id) return;

                    const rawProgress = quest.config.configVersion === 1
                        ? data.userStatus?.streamProgressSeconds
                        : data.userStatus?.progress?.PLAY_ON_DESKTOP?.value;

                    if (rawProgress == null) return;
                    const progress = Math.floor(rawProgress);

                    showToast(`[${questName}] Progress: ${progress}/${secondsNeeded}s`, 0);

                    if (progress >= secondsNeeded) {
                        RunningGameStore.getRunningGames = realGetRunningGames;
                        RunningGameStore.getGameForPID = realGetGameForPID;
                        FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: fakeGames, added: [], games: [] });
                        FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);

                        showToast(`Completed: ${questName}`, 1);
                        setTimeout(() => this.runQuestJob(quests), 2500);
                    }
                };

                FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                showToast(`Spoofed game to ${appData.name}. Wait ~${Math.ceil((secondsNeeded - secondsDone) / 60)} min.`, 0);
            }).catch(err => {
                showToast(`Failed to fetch app data: ${err}`, 2);
                console.error("[QuestCompleter]", err);
            });
        } else if (taskName === "STREAM_ON_DESKTOP") {
            const realFunc = ApplicationStreamingStore.getStreamerActiveStreamMetadata;
            ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({
                id: applicationId,
                pid,
                sourceName: null
            });

            const fn = (data: any) => {
                if (data.questId && data.questId !== quest.id) return;

                const rawProgress = quest.config.configVersion === 1
                    ? data.userStatus?.streamProgressSeconds
                    : data.userStatus?.progress?.STREAM_ON_DESKTOP?.value;

                if (rawProgress == null) return;
                const progress = Math.floor(rawProgress);

                showToast(`[${questName}] Progress: ${progress}/${secondsNeeded}s`, 0);

                if (progress >= secondsNeeded) {
                    ApplicationStreamingStore.getStreamerActiveStreamMetadata = realFunc;
                    FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);

                    showToast(`Completed: ${questName}`, 1);
                    setTimeout(() => this.runQuestJob(quests), 2500);
                }
            };

            FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
            showToast(`Spoofed stream for ${questName}. Stream any window in VC with 1+ person for ~${Math.ceil((secondsNeeded - secondsDone) / 60)} min.`, 0);
        } else if (taskName === "PLAY_ACTIVITY") {
            const channelId = ChannelStore.getSortedPrivateChannels()[0]?.id ??
                (Object.values(GuildChannelStore.getAllGuilds()) as any[]).find(x => x != null && x.VOCAL?.length > 0)?.VOCAL[0]?.channel?.id;

            if (!channelId) {
                showToast(`Skipped ${questName}: No voice or DM channel found.`, 2);
                return setTimeout(() => this.runQuestJob(quests), 1500);
            }

            const streamKey = `call:${channelId}:1`;

            const fn = async () => {
                try {
                    while (true) {
                        const res = await RestAPI.post({
                            url: `/quests/${quest.id}/heartbeat`,
                            body: { stream_key: streamKey, terminal: false }
                        });
                        const progress = res.body.progress.PLAY_ACTIVITY.value;
                        showToast(`[${questName}] Progress: ${progress}/${secondsNeeded}s`, 0);

                        await new Promise(resolve => setTimeout(resolve, 20 * 1000));

                        if (progress >= secondsNeeded) {
                            await RestAPI.post({
                                url: `/quests/${quest.id}/heartbeat`,
                                body: { stream_key: streamKey, terminal: true }
                            });
                            break;
                        }
                    }

                    showToast(`Completed: ${questName}`, 1);
                    setTimeout(() => this.runQuestJob(quests), 1500);
                } catch (err) {
                    showToast(`Activity quest error: ${err}`, 2);
                    console.error("[QuestCompleter]", err);
                }
            };

            fn();
        }
    },

    CompleteQuestButton() {
        return () => (
            <Button size="small" onClick={() => this.completeQuest()}>
                Complete Recent Quest
            </Button>
        );
    }
});
