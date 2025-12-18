import {
    POSITION_SENDING_METHOD,
    TEST_MODE,
    BENCHMARK_QUESTIONS,
    CAMIO_FILE_NAME
} from "../inputSettings";

import { getEphemeralKey } from "../ephemeralKey/getEphemeralKey";
import { INPUT_TOKEN_LIMIT, createSessionConfig } from "./sessionConfig";
import { BenchmarkQuestion } from "../testModeQuestions/benchmarkQuestions";

import {
    imageToBase64,
    base64ToBlob,
    showBlobTypeDimSize,
    checkBlobSize,
    toWebp,
    reduceResolution,
    getImgDimensions,
    compressWebpBlob,
    mapLangCodeToName,
    drawPointedPosition,
    base64ToGrayScale
} from '../utils/utils';

type RealtimeMessage = {
    type: string;
    event_id: string;
    [key: string]: any; // allows for other unknown properties
};

type InputText = {
    type: "input_text";
    text: string;
};

type InputImage = {
    type: "input_image";
    image_url: string;
};

type PositionMessageItem = InputText | InputImage;
type PositionMessageContent = PositionMessageItem[];

interface UIElements {
    startBtn: HTMLButtonElement;
    stopBtn: HTMLButtonElement;
    sessionState: HTMLElement;
    runTestsBtn: HTMLButtonElement;
    audioState: HTMLElement;
    modelResponse: HTMLElement;
    xCoord: HTMLInputElement;
    yCoord: HTMLInputElement;
    hotspotSelect: HTMLSelectElement;
}

export class RealtimeInteraction {
    private static instance: RealtimeInteraction | null = null;

    private data: any | null = null;
    private template: string | null = null;
    private colorMap: string | null = null;

    private peerConnection: RTCPeerConnection | null = null;
    private audioElement: HTMLAudioElement | null = null;
    private localStream: MediaStream | null = null;
    private dataChannel: RTCDataChannel | null = null;

    private ephemeralKey: string | null = null;
    private elements: UIElements | null = null;

    private audioResponsesOn: boolean = false;

    private requestStartTime: number | null = null;
    private responseStarted: boolean = false;
    private responseTimes: number[] = [];

    private grayScaleBase64Template: string | null = null;
    private imgDimensions: { x: number; y: number } = { x: -1, y: -1 }; // -1 are only placeholders

    private lastImgWithPositionItemId: string | null = null;

    private conversationItems: string[] = [];

    private questionNumber: number = -1; // for test mode

    // ---------------
    // INITIALIZATION
    // ---------------

    private constructor() { }

    public static getInstance(): RealtimeInteraction {
        if (!RealtimeInteraction.instance) {
            RealtimeInteraction.instance = new RealtimeInteraction();
        }

        return RealtimeInteraction.instance;
    }

    public async init(): Promise<void> {
        this.initializeUIElements();
        if (!this.elements) return console.error("UI elements not initialized");

        await this.initProjectFiles();

        this.elements.startBtn.onclick = () => this.startSession();
        this.elements.stopBtn.onclick = () => this.stopSession();

        this.elements.runTestsBtn.onclick = () => this.runBenchmarkTests();

        this.handleSessionState(false);
        this.handleAudioState(false);
        this.handleRunTestsBtn(false);
    }

    private initializeUIElements(): void {
        this.elements = {
            startBtn: document.getElementById("startBtn") as HTMLButtonElement,
            stopBtn: document.getElementById("stopBtn") as HTMLButtonElement,
            sessionState: document.getElementById("sessionState") as HTMLElement,
            runTestsBtn: document.getElementById("runTestsBtn") as HTMLButtonElement,
            audioState: document.getElementById("audioState") as HTMLElement,
            modelResponse: document.getElementById("modelResponse") as HTMLElement,
            xCoord: document.getElementById("xCoord") as HTMLInputElement,
            yCoord: document.getElementById("yCoord") as HTMLInputElement,
            hotspotSelect: document.getElementById("hotspotSelect") as HTMLSelectElement
        }
    }

    private async initProjectFiles(): Promise<void> {
        try {
            console.log("Preparing project files...");

            const data = await this.getFileData();
            const template = await this.getFileTemplate();
            const colorMap = await this.getFileColorMap();

            if (!data) throw new Error("Failed to load data file");
            if (!template) throw new Error("Failed to load template file");
            if (!colorMap) throw new Error("Failed to load color map file");

            const sendableTemplate = await this.getSendableImage(template); // base64 string
            const sendableColorMap = await this.getSendableImage(colorMap); // base64 string

            if (!sendableTemplate) throw new Error("The template image is too large to be sent to LLM");
            if (!sendableColorMap) throw new Error("The color map image is too large to be sent to LLM");

            this.grayScaleBase64Template = await base64ToGrayScale(sendableTemplate);
            this.imgDimensions = await getImgDimensions(sendableTemplate);

            this.data = data;
            this.template = sendableTemplate;
            this.colorMap = sendableColorMap;

            console.log("Project files prepared");

        } catch (err) {
            console.error("Failed to prepare project files:", err);
            this.stopSession();
        }
    }

    private async getFileData(): Promise<any> {
        const path = "/" + CAMIO_FILE_NAME + "/data.json";
        const response = await fetch(path);
        if (!response.ok) throw new Error(`Cannot fetch ${path}`);
        return await response.json();
    }

    private async getFileTemplate(): Promise<string> {
        const path = "/" + CAMIO_FILE_NAME + "/template.png";
        const response = await fetch(path);
        if (!response.ok) throw new Error(`Cannot fetch ${path}`);
        const blob = await response.blob();
        return await imageToBase64(blob);
    }

    private async getFileColorMap(): Promise<string> {
        const path = "/" + CAMIO_FILE_NAME + "/colorMap.png";
        const response = await fetch(path);
        if (!response.ok) throw new Error(`Cannot fetch ${path}`);
        const blob = await response.blob();
        return await imageToBase64(blob);
    }

    private async getSendableImage(initialBase64Image: string): Promise<string | null> {
        const maxImageSize: number = 220;

        try {
            const blob = base64ToBlob(initialBase64Image);

            const reducedDimBlob = await reduceResolution(blob); // reduce dimensions of the blob

            const webpBlob = await toWebp(reducedDimBlob); // convert in webp image

            if (checkBlobSize(webpBlob, maxImageSize)) return await imageToBase64(webpBlob); // send webp converted image

            let quality = 0.9;
            while (quality >= 0.0) {
                const compressedBlob = await compressWebpBlob(webpBlob, quality);
                if (checkBlobSize(compressedBlob, maxImageSize)) return await imageToBase64(compressedBlob); // send webp compressed image
                quality -= 0.1;
            }

            return null;

        } catch (err) {
            throw new Error('Image processing failed:' + (err as Error).message);
        }
    }

    // -----------------
    // SESSION HANDLING
    // -----------------

    private async startSession(): Promise<void> {
        this.ephemeralKey = await getEphemeralKey();
        if (!this.ephemeralKey) return;

        console.log("Starting realtime session");

        if (!this.setupPeerConnection()) return;
        if (!this.setupRemoteAudio()) return;
        if (!(await this.setupLocalAudio())) return;
        if (!this.setupDataChannel()) return;
        await this.connectToModel();

        this.resetLastImgWithPositionItemId();
    }

    private stopSession(): void {
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }

        if (this.localStream) {
            this.localStream.getTracks().forEach((t) => t.stop());
            this.localStream = null;
            //this.logStatus("LocalStream", "closed");
        }

        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
            //this.logStatus("PeerConnection", "closed");
        }

        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.srcObject = null;
            this.audioElement.remove();
            this.audioElement = null;
            //this.logStatus("AudioElement", "closed");
        }

        console.log("Realtime session closed");
        this.handleSessionState(false);
        this.handleAudioState(false);
        this.handleRunTestsBtn(false);
    }

    // -------
    // RESETS 
    // -------

    private resetLastImgWithPositionItemId(): void {
        this.lastImgWithPositionItemId = null;
    }

    // ------------
    // UI HANDLING
    // ------------

    private handleSessionState(state: boolean): void {
        if (!this.elements) return console.error("UI elements not initialized");

        if (state) {
            this.elements.sessionState.textContent = "Session on";
            this.elements.sessionState.classList.add("stateOn");
            this.elements.sessionState.classList.remove("stateOff");
            this.elements.startBtn.disabled = true;
            this.elements.stopBtn.disabled = false;

        } else {
            this.elements.modelResponse.textContent = "The model response will appear here...";

            this.elements.sessionState.textContent = "Session off";
            this.elements.sessionState.classList.add("stateOff");
            this.elements.sessionState.classList.remove("stateOn");
            this.elements.startBtn.disabled = false;
            this.elements.stopBtn.disabled = true;
        }
    }

    private handleAudioState(state: boolean): void {
        if (!this.elements) return console.error("UI elements not initialized");

        if (state) {
            this.audioResponsesOn = true;
            this.elements.audioState.textContent = "Audio on";

        } else {
            this.audioResponsesOn = false;
            this.elements.audioState.textContent = "Audio off";
        }
    }

    private handleRunTestsBtn(state: boolean): void {
        if (!this.elements) return console.error("UI elements not initialized");

        if (!TEST_MODE) {
            this.elements.runTestsBtn.hidden = true;
            return;
        }

        this.elements.runTestsBtn.disabled = !state;
    }

    // ------------
    // CONSOLE LOG
    // ------------

    private logStatus(component: string, status: "ready" | "error" | "closed", detail?: string): void {
        const prefix = '[' + component + ']';

        if (status === "ready") {
            console.log(prefix + ' Ready', detail ?? "");
        } else if (status === "closed") {
            console.log(prefix + ' Closed', detail ?? "");
        } else {
            const err = prefix + ' Error ' + (detail ?? "");
            console.error(err);
        }
    }

    // -----------------
    // CONNECTION SETUP
    // -----------------

    private setupPeerConnection(): boolean {
        try {
            this.peerConnection = new RTCPeerConnection();
            //this.logStatus("PeerConnection", "ready");
            return true;

        } catch (err) {
            this.logStatus("PeerConnection", "error", "Failed initializing PeerConnection");
            this.stopSession();
            return false;
        }
    }

    private checkPeerConnection(): boolean {
        if (!this.peerConnection) {
            this.logStatus("PeerConnection", "error", "PeerConnection not available");
            this.stopSession();
            return false;
        }
        return true;
    }

    // captures audio sent by the model and plays it back
    private setupRemoteAudio(): boolean {
        if (!this.checkPeerConnection()) return false;

        this.audioElement = document.createElement("audio");
        document.body.appendChild(this.audioElement);
        this.audioElement.autoplay = true;

        this.peerConnection!.ontrack = (e) => {
            this.audioElement!.srcObject = e.streams[0] ?? null;

            this.audioElement!.onloadedmetadata = () => {
                //this.logStatus("RemoteAudio", "ready");
            }

            this.audioElement!.onerror = (err) => {
                this.logStatus("RemoteAudio", "error", 'Playback error: ' + (err as ErrorEvent).message);
                this.stopSession();
            }
        }

        return true;
    }

    // captures microphone audio and sends it to the model
    private async setupLocalAudio(): Promise<boolean> {
        if (!this.checkPeerConnection()) return false;

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.localStream.getTracks().forEach((track) => {
                this.peerConnection?.addTrack(track, this.localStream!);
            });
            //this.logStatus("LocalAudio", "ready");
            return true;

        } catch (err) {
            if (err instanceof Error) {
                this.logStatus("LocalAudio", "error", err.message);
            } else {
                this.logStatus("LocalAudio", "error", String(err));
            }
            this.stopSession();
            return false;
        }
    }

    private setupDataChannel(): boolean {
        if (!this.checkPeerConnection()) return false;

        this.dataChannel = this.peerConnection!.createDataChannel("oai-events") ?? null;
        if (!this.dataChannel) {
            this.logStatus("DataChannel", "error", "Failed initializing dataChannel");
            this.stopSession();
            return false;
        }

        this.dataChannel.onopen = () => {
            //this.logStatus("DataChannel", "ready");
        }

        this.dataChannel.onclose = () => {
            //this.logStatus("DataChannel", "closed");
        }

        this.dataChannel.onerror = (e: Event) => {
            console.error("[DataChannel] Error", e);
            this.stopSession();
        };

        this.dataChannel.onmessage = (e: MessageEvent) => this.handleDataChannelMessages(e);

        return true;
    }

    private async handleDataChannelMessages(e: MessageEvent): Promise<void> {
        try {
            const msg: RealtimeMessage = JSON.parse(e.data);
            //console.log(msg);
            //console.log(msg.type);

            switch (msg.type) {
                // session created
                case "session.created":
                    console.log("Realtime session started");
                    this.handleSessionState(true);
                    if (TEST_MODE) this.handleRunTestsBtn(true);
                    this.initSession();
                    this.sendFileContent();
                    if (!TEST_MODE) this.enableTurnDetection();
                    break;

                // error
                case "error":
                    const errorMsg = msg.error?.message;
                    if (errorMsg) this.logStatus("DataChannel", "error", errorMsg);
                    break;

                // audio input
                case "input_audio_buffer.speech_started":
                    await this.sendPointedPosition();
                    this.addFictitiousResponseToConversation();
                    break;

                case "input_audio_buffer.committed":
                    console.log("Audio request sent to the LLM");
                    this.dataChannel!.send(JSON.stringify({ type: "response.create" }));
                    this.startResponseTimer();
                    break;

                // conversation items
                case "conversation.item.added":
                    this.addItemToConversationItemList(msg.item.id);
                    break;
                
                case "conversation.item.done":
                    const item = msg.item;
                    // get item_id of image with position message
                    // note: this is not a robust method to extract pointed position image messages, but it is the simplest one
                    if (item.type == "message" &&
                        item.content?.[0]?.type === "input_text" &&
                        item.content?.[0]?.text === "The user is pointing at the position represented in this image:" &&
                        item.content?.[1]?.type === "input_image") {
                        this.setLastImgWithPositionItemID(item.id);
                    }
                    break;

                // transcription of the text response in the UI
                case "response.content_part.added":
                    if (this.elements) this.elements.modelResponse.textContent = "";
                    break;

                // response delta
                case "response.output_text.delta":
                    this.printResponseTime();
                    if (msg.delta && this.elements) this.elements.modelResponse.textContent += msg.delta;
                    break;

                case "response.output_audio_transcript.delta":
                    this.printResponseTime();
                    if (msg.delta && this.elements) this.elements.modelResponse.textContent += msg.delta;
                    break;

                // transcription of the text response in console
                case "response.output_text.done":
                    console.log("LLM response: " + msg.text);
                    break;

                case "response.output_audio_transcript.done":
                    console.log("LLM response: " + msg.transcript);
                    break;

                // response done
                case "response.done":
                    if (msg.response?.status === "failed") {
                        const error = msg.response.status_details?.error;
                        if (error) this.logStatus("DataChannel", "error", error.message);
                        this.stopSession();
                    } else {
                        this.printTokenUsage(msg);
                        this.deletePartOfConversationIfNecessary(msg);
                        if (msg.response?.output?.[0]?.type === "message" && TEST_MODE) await this.sendTestMessage();
                    }
                    break;

                // function calls
                case "response.function_call_arguments.done":
                    this.handleFunctionCalls(msg);
                    break;

                default:
            }

        } catch (err) {
            if (err instanceof Error) {
                this.logStatus("DataChannel", "error", err.message);
            } else {
                this.logStatus("DataChannel", "error", String(err));
            }
            this.stopSession();
        }
    }

    private async connectToModel(): Promise<void> {
        try {
            if (!this.checkPeerConnection()) return;

            const offer = await this.peerConnection!.createOffer();
            await this.peerConnection!.setLocalDescription(offer);

            const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
                method: "POST",
                body: offer.sdp ?? null,
                headers: {
                    Authorization: "Bearer " + this.ephemeralKey,
                    "Content-Type": "application/sdp",
                },
            });

            if (!sdpResponse.ok) {
                const errorText = await sdpResponse.text();
                throw new Error(errorText);
            }

            const answer: RTCSessionDescriptionInit = {
                type: "answer",
                sdp: await sdpResponse.text()
            };
            await this.peerConnection!.setRemoteDescription(answer);

            //this.logStatus("ConnectToModel", "ready");

        } catch (err) {
            if (err instanceof Error) {
                this.logStatus("ConnectToModel", "error", err.message);
            } else {
                this.logStatus("ConnectToModel", "error", String(err));
            }
            this.stopSession();
        }
    }

    // ----------------------
    // SEND INITIAL MESSAGES
    // ----------------------

    private async initSession(): Promise<void> {
        if (!this.dataChannel) return this.stopSession();

        let langCode = "en-US";
        let lang = "English (US)";
        try {
            const data = await this.getFileData();
            langCode = data.metadata.lang || "en-US";
            lang = mapLangCodeToName(langCode);

        } catch (err) {
            console.warn("Could not determine language from data.json, using English.");
        }

        const config = {
            type: "session.update",
            session: createSessionConfig(lang)
        };

        this.dataChannel.send(JSON.stringify(config));
        console.log("Session configuration and system prompt sent to the LLM");
    }

    private async sendFileContent(): Promise<void> {
        if (!this.dataChannel) return this.stopSession();
        if (!this.data || !this.template || !this.colorMap) return this.stopSession();

        try {
            this.sendData(JSON.stringify(this.data));
            this.sendImage(this.template, "template");
            this.sendImage(this.colorMap, "colorMap");

        } catch (err) {
            console.error("Failed to send camio file content:", err);
            this.stopSession();
        }
    }

    private sendData(data: string): void {
        if (!this.dataChannel) return this.stopSession();

        const res = {
            type: "conversation.item.create",
            item: {
                type: "message",
                role: "user",
                content: [
                    {
                        type: "input_text",
                        text: "Tactile drawing data:"
                    },
                    {
                        type: "input_text",
                        text: data
                    }
                ]
            }
        }

        this.dataChannel.send(JSON.stringify(res));
        console.log("data.json file sent to the LLM");
    }

    private sendImage(base64Image: string, type: string): void {
        if (!this.dataChannel) return this.stopSession();

        let textMsg: string = "";
        if (type === "template") {
            textMsg = "Tactile drawing template image:";
        } else if (type === "colorMap") {
            textMsg = "Tactile drawing color map image:";
        }

        const res = {
            type: "conversation.item.create",
            item: {
                type: "message",
                role: "user",
                content: [
                    {
                        type: "input_text",
                        text: textMsg
                    },
                    {
                        type: "input_image",
                        image_url: base64Image
                    }
                ]
            }
        }

        this.dataChannel.send(JSON.stringify(res));
        console.log("Image " + type + " file sent to the the LLM");
    }

    private enableTurnDetection(): void {
        if (!this.dataChannel) return this.stopSession();

        const enableTurnDetectionOutput = {
            type: "session.update",
            session: {
                type: "realtime",
                audio: {
                    input: {
                        turn_detection: { // enable auto audio detection
                            type: "server_vad",
                            create_response: false, // disable auto responses
                            interrupt_response: true,
                            silence_duration_ms: 500 // 500 default
                        }
                    }
                }
            }
        }

        this.dataChannel.send(JSON.stringify(enableTurnDetectionOutput));
        console.log("LLM audio detection enabled");
    }

    // ------------------------
    // FUNCTION CALLS HANDLING
    // ------------------------

    private handleFunctionCalls(msg: RealtimeMessage): void {
        switch (msg.name) {
            case "wake_word":
                this.enableAudio();
                break;

            case "sleep_word":
                this.disableAudio();
                break;
        }
    }

    private enableAudio(): void {
        console.warn("Called function enableAudio()");
        if (!this.dataChannel) return this.stopSession();

        if (this.audioResponsesOn) { // audio already enabled
            const audioAlreadyEnabled = {
                type: "response.create",
                response: {
                    instructions: `
                        - Do not call any function.
                        - Only notify the user that audio is already enabled.
                        - Keep the response very short.
                        `,
                    //input: []
                }
            }
            this.dataChannel.send(JSON.stringify(audioAlreadyEnabled));
            return;
        }

        const enableAudioOutput = {
            type: "session.update",
            session: {
                type: "realtime",
                output_modalities: ["audio"], // text, if using test mode
            }
        }

        this.dataChannel.send(JSON.stringify(enableAudioOutput));
        this.handleAudioState(true);
        this.dataChannel.send(JSON.stringify({ type: "response.create" }));
    }

    private async disableAudio(): Promise<void> {
        console.warn("Called function disableAudio()");
        if (!this.dataChannel) return this.stopSession();

        if (!this.audioResponsesOn) { // audio already disabled
            const audioAlreadyDisabled = {
                type: "response.create",
                response: {
                    instructions: `
                        - Do not call any function.
                        - Only notify the user that audio is already disabled.
                        - Keep the response very short.
                        `,
                    //input: []
                }
            }
            this.dataChannel.send(JSON.stringify(audioAlreadyDisabled));
            return;
        }

        const disableAudioOutput = {
            type: "session.update",
            session: {
                type: "realtime",
                output_modalities: ["text"]
            }
        }

        this.dataChannel.send(JSON.stringify(disableAudioOutput));
        this.handleAudioState(false);
        this.feedbackAudioDisabled();
    }

    private feedbackAudioDisabled() {
        if (!this.dataChannel) return this.stopSession();

        const audioDisFeedback = {
            type: "response.create",
            response: {
                output_modalities: ["audio"], // text, if using test mode
                instructions: `
                    - Do not call any function.
                    - Only notify the user that audio has been disabled.
                    - Keep the response very short.
                    `,
                //input: []
            }
        }

        this.dataChannel.send(JSON.stringify(audioDisFeedback));
    }

    // --------------
    // RESPONSE TIME
    // --------------

    private startResponseTimer(): void {
        this.requestStartTime = performance.now();
        this.responseStarted = false;
    }

    private printResponseTime(): void {
        if (!this.responseStarted && this.requestStartTime != null) {
            const latency = Math.round(performance.now() - this.requestStartTime);
            console.log(`LLM response time: ${latency} ms`);
            if (TEST_MODE) this.responseTimes.push(latency);
            this.responseStarted = true;
        }
    }

    // -----------------
    // POINTED POSITION
    // -----------------

    private getCurrentPointedPosition(): { x: number | null, y: number | null } {
        if (!this.elements) throw new Error("UI elements not initialized");

        const x = Number.isNaN(this.elements.xCoord.valueAsNumber) ? null : this.elements.xCoord.valueAsNumber;
        const y = Number.isNaN(this.elements.yCoord.valueAsNumber) ? null : this.elements.yCoord.valueAsNumber;

        return { x, y };
    }

    private getCurrentHotspot(): string | null {
        if (!this.elements) throw new Error("UI elements not initialized");

        const hotspot = this.elements.hotspotSelect.value === "null" ? null : this.elements.hotspotSelect.value;

        return hotspot;
    }

    private async sendPointedPosition(): Promise<void> {
        try {
            if (!this.dataChannel) throw new Error("Data channel missing");

            const { x, y } = this.getCurrentPointedPosition();
            const hotspot = this.getCurrentHotspot();

            const contentRes = await this.buildPointedPositionMessage(x, y, hotspot);
            if (!contentRes) return;

            const res = {
                type: "conversation.item.create",
                item: {
                    type: "message",
                    role: "user",
                    content: contentRes
                }
            };

            this.dataChannel.send(JSON.stringify(res));
            this.logPositionSent(x, y, hotspot);

        } catch (err) {
            if (err) console.error(err);
            this.stopSession();
        }
    }

    private getNormalizedCoords(currentX: number, currentY: number): { normX: number, normY: number } {
        const { x: imgX, y: imgY } = this.imgDimensions;
        const normX = currentX / imgX;
        const normY = currentY / imgY;
        return { normX, normY };
    }

    private async buildPointedPositionMessage(x: number | null, y: number | null, hotspot: string | null): Promise<PositionMessageContent | null> {
        if (POSITION_SENDING_METHOD == null) return null;

        if (x === null || y === null) {
            return [{ type: "input_text", text: "The user is not pointing any position." }];
        }

        const { x: imgX, y: imgY } = this.imgDimensions;
        const normCoords = this.getNormalizedCoords(x, y);

        const normCoordText = `The user is pointing at the following coordinates:
                                (x: ${normCoords.normX.toFixed(3)}, y: ${normCoords.normY.toFixed(3)})`;

        const coordText = `The user is pointing at the following coordinates (in pixels):
                            (x: ${x} px, y: ${y} px)`;

        const imgDimText = `The drawing template and the color map have the following dimensions:
                            ${imgX}x${imgY} px`;

        const coordHotspot = `${hotspot
            ? `They correspond to this hotspot: ${hotspot}`
            : "They do not correspond to any known hotspot"}`;

        const imgHotspot = `${hotspot
            ? `It corresponds to this hotspot: ${hotspot}`
            : "It does not correspond to any known hotspot"}`;

        switch (POSITION_SENDING_METHOD) {
            case "normCoord":
                return [{ type: "input_text", text: normCoordText }];

            case "normCoordAndHotspot":
                return [{ type: "input_text", text: `${normCoordText}\n${coordHotspot}` }];

            case "coord":
                return [{ type: "input_text", text: `${coordText}\n${imgDimText}` }];

            case "coordAndHotspot":
                return [{ type: "input_text", text: `${coordText}\n${coordHotspot}\n${imgDimText}` }];

            case "imgWithPos": {
                if (!this.grayScaleBase64Template) throw new Error("Gray scale image template missing");
                const imgWithPosition = await drawPointedPosition(this.grayScaleBase64Template, x, y);
                this.deleteLastImgWithPosition();
                return [
                    { type: "input_text", text: "The user is pointing at the position represented in this image:" },
                    { type: "input_image", image_url: imgWithPosition }
                ];
            }

            case "imgWithPosAndHotspot": {
                if (!this.grayScaleBase64Template) throw new Error("Gray scale image template missing");
                const imgWithPosition = await drawPointedPosition(this.grayScaleBase64Template!, x, y);
                this.deleteLastImgWithPosition();
                return [
                    { type: "input_text", text: "The user is pointing at the position represented in this image:" },
                    { type: "input_image", image_url: imgWithPosition },
                    { type: "input_text", text: imgHotspot }
                ];
            }

            default:
                return null;
        }
    }

    private logPositionSent(
        x: number | null,
        y: number | null,
        hotspot: string | null
    ): void {
        if (POSITION_SENDING_METHOD == null) return;

        if (x === null || y === null) return console.log("No-pointing message sent to the LLM");

        //console.log(`Pointed position coordinates: (x: ${x.toFixed(0)} px, y: ${y.toFixed(0)} px)`);

        switch (POSITION_SENDING_METHOD) {
            case "normCoord":
                return console.log("Pointed position normalized coordinates sent to the LLM");

            case "normCoordAndHotspot":
                return console.log(`Pointed position normalized coordinates and hotspot ${hotspot} sent to the LLM`);

            case "coord":
                return console.log("Pointed position pixel coordinates sent to the LLM");

            case "coordAndHotspot":
                return console.log(`Pointed position pixel coordinates and hotspot ${hotspot} sent to the LLM`);

            case "imgWithPos": {
                return console.log("Pointed position image sent to the LLM");
            }

            case "imgWithPosAndHotspot": {
                return console.log(`Pointed position image and hotspot ${hotspot} sent to the LLM`);
            }
        }
    }

    private addFictitiousResponseToConversation(): void {
        if (!this.dataChannel) return this.stopSession();

        const res = {
            type: "conversation.item.create",
            item: {
                type: "message",
                role: "assistant",
                content: [{
                    type: "output_text",
                    text: "I must not respond to this request because it is only metadata."
                }]
            }
        };

        this.dataChannel.send(JSON.stringify(res));
        console.log("Fictitious response add to LLM conversation");
    }

    // --------------------------------
    // PREVIOUS POINTED POSITION IMAGE
    // --------------------------------

    private setLastImgWithPositionItemID(itemId: string): void {
        this.lastImgWithPositionItemId = itemId;
    }

    private deleteLastImgWithPosition(): void {
        const itemId = this.lastImgWithPositionItemId;

        this.deleteItemFromConversation(itemId);
    }

    // ----------
    // TEST MODE
    // ----------

    private async runBenchmarkTests(): Promise<void> {
        this.handleRunTestsBtn(false);
        await this.sendTestMessage();
    }

    private async sendTestMessage(): Promise<void> {
        if (!this.dataChannel) return this.stopSession();

        this.questionNumber++;
        const question = BENCHMARK_QUESTIONS[this.questionNumber];

        if (!question) {
            const averageResponseTime = Math.round(
                this.responseTimes.reduce((sum, val) => sum + val, 0) / this.responseTimes.length
            );
            console.log(`Average LLM response time: ${averageResponseTime} ms`)
            this.responseTimes = [];

            this.questionNumber = -1;
            this.handleRunTestsBtn(true);
            return;
        }

        this.setTestCoordsAndHotspot(question);
        await this.sendPointedPosition();
        this.addFictitiousResponseToConversation();
        await this.sendTestQuestion(question);
        this.dataChannel.send(JSON.stringify({ type: "response.create" }));
        this.startResponseTimer();
    }

    private setTestCoordsAndHotspot(question: BenchmarkQuestion): void {
        if (!this.elements) return console.error("UI elements not initialized");

        const { x, y } = question.position;
        const hotspot = question.hotspot;

        this.elements.xCoord.value = x != null ? String(x) : "";
        this.elements.yCoord.value = y != null ? String(y) : "";

        this.elements.xCoord.dispatchEvent(new Event("input", { bubbles: true }));
        this.elements.yCoord.dispatchEvent(new Event("input", { bubbles: true }));

        this.elements.hotspotSelect.value = hotspot != null ? hotspot : "null";
    }

    private async sendTestQuestion(quest: BenchmarkQuestion): Promise<void> {
        if (!this.dataChannel) return this.stopSession();

        const res = {
            type: "conversation.item.create",
            item: {
                type: "message",
                role: "user",
                content: [
                    {
                        type: "input_text",
                        text: quest.question
                    }
                ]
            }
        }

        this.dataChannel.send(JSON.stringify(res));
        console.log(`Test question ${this.questionNumber + 1} sent to the LLM`);
    }

    // ------------
    // TOKEN USAGE
    // ------------

    private printTokenUsage(msg: any): void {
        const usage = msg.response?.usage;
        if (!usage) return;

        console.log("LLM token usage:", usage);
    }

    // ---------------------------
    // CONVERSATION ITEM HANDLING
    // ---------------------------

    private addItemToConversationItemList(itemId: string): void {
        if (!itemId) return;
        this.conversationItems.push(itemId);
    }

    private deleteItemFromConversation(itemId: string | null): void {
        if (!this.dataChannel) return this.stopSession();
        if (!itemId) return;

        const index = this.conversationItems.indexOf(itemId);
        if (index == -1) return;

        const deleteItem = {
            type: "conversation.item.delete",
            item_id: itemId
        };

        this.conversationItems.splice(index, 1);
        this.dataChannel.send(JSON.stringify(deleteItem));
    }

    private deletePartOfConversationIfNecessary(msg: any): void {
        const inputTokens = msg.response?.usage?.input_tokens;
        if (!inputTokens) return;

        // when the context contains at least 80% of the limit token count, the first 30% of messages are dropped from the conversation (not data, template, and color map)
        // 80% and 30% are editable values
        const itemRemovalRate = 0.3;
        const conversationLimitRate = 0.8;

        if (inputTokens >= INPUT_TOKEN_LIMIT * conversationLimitRate) {
            const startIndex = 3;
            if (this.conversationItems.length > startIndex) {
                const removableCount = Math.floor(this.conversationItems.length * itemRemovalRate);

                for (let i = 0; i < removableCount; i++) {
                    const itemId = this.conversationItems[startIndex];
                    this.deleteItemFromConversation(itemId);
                }

                console.log(`Deleted ${removableCount} items from conversation context`);
            }
        }
    }
}