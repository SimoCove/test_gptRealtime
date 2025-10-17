import sessionConfig from "./sessionConfig";
import {
    imageToBase64,
    base64ToBlob,
    showBlobTypeDimSize,
    checkBlobSize,
    toWebp,
    reduceResolution,
    compressWebpBlob
} from '../utils/utils';

type RealtimeMessage = {
    type: string;
    event_id: string;
    [key: string]: any; // allows for other unknown properties
};

interface UIElements {
    startBtn: HTMLButtonElement;
    stopBtn: HTMLButtonElement;
    sessionState: HTMLElement;
    audioState: HTMLElement;
    modelResponse: HTMLElement;
}

export class RealtimeInteraction {
    private static instance: RealtimeInteraction | null = null;

    private peerConnection: RTCPeerConnection | null = null;
    private audioElement: HTMLAudioElement | null = null;
    private localStream: MediaStream | null = null;
    private dataChannel: RTCDataChannel | null = null;

    private sessionReady: boolean = false;
    private ephemeralKey: string | null = null;

    private elements: UIElements | null = null;

    private flagAudioDisFeedback: boolean = false;

    private constructor() { }

    public static getInstance(): RealtimeInteraction {
        if (!RealtimeInteraction.instance) {
            RealtimeInteraction.instance = new RealtimeInteraction();
        }

        return RealtimeInteraction.instance;
    }

    public init(ephemeralKey: string | null): void {
        this.ephemeralKey = ephemeralKey;

        this.initializeUIElements();
        if (!this.elements) return console.error("UI elements not initialized");

        this.elements.startBtn.onclick = () => this.startSession();
        this.elements.stopBtn.onclick = () => this.stopSession();

        this.handleSessionState(false);
        this.handleAudioState(false);
    }

    private initializeUIElements(): void {
        this.elements = {
            startBtn: document.getElementById("startBtn") as HTMLButtonElement,
            stopBtn: document.getElementById("stopBtn") as HTMLButtonElement,
            sessionState: document.getElementById("sessionState") as HTMLElement,
            audioState: document.getElementById("audioState") as HTMLElement,
            modelResponse: document.getElementById("modelResponse") as HTMLElement
        }
    }

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
            this.elements.audioState.textContent = "Audio on";
            this.elements.audioState.classList.remove("stateDisabled");
            this.elements.audioState.classList.add("stateEnabled");

        } else {
            this.elements.audioState.textContent = "Audio off";
            this.elements.audioState.classList.add("stateDisabled");
            this.elements.audioState.classList.remove("stateEnabled");
        }
    }

    private logStatus(component: string, status: "ready" | "error" | "closed", detail?: string): void {
        const prefix = '[' + component + ']';

        if (status === "ready") {
            console.log(prefix + ' Ready', detail ?? "");
        } else if (status === "closed") {
            console.log(prefix + ' Closed', detail ?? "");
        } else {
            const err = prefix + ' Error ' + (detail ?? "");
            console.error(err);
            alert(err);
        }
    }

    private async startSession(): Promise<void> {
        if (!this.ephemeralKey) return;

        console.log("Starting session");

        if (!this.setupPeerConnection()) return;
        if (!this.setupRemoteAudio()) return;
        if (!(await this.setupLocalAudio())) return;
        if (!this.setupDataChannel()) return;
        await this.connectToModel();
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

        this.sessionReady = false;
        console.log("Session closed");
        this.handleSessionState(false);
        this.handleAudioState(false);
    }

    private setupPeerConnection(): boolean {
        this.peerConnection = new RTCPeerConnection();
        if (!this.peerConnection) {
            this.logStatus("PeerConnection", "error", "Failed initializing PeerConnection");
            this.stopSession();
            return false;
        }

        //this.logStatus("PeerConnection", "ready");
        return true;
    }

    // captures audio sent by the model and plays it back
    private setupRemoteAudio(): boolean {
        if (!this.peerConnection) {
            this.logStatus("RemoteAudio", "error", "PeerConnection not available");
            this.stopSession();
            return false;
        }

        this.audioElement = document.createElement("audio");
        document.body.appendChild(this.audioElement);
        this.audioElement.autoplay = true;

        this.peerConnection.ontrack = (e) => {
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
        if (!this.peerConnection) {
            this.logStatus("LocalAudio", "error", "PeerConnection not available");
            this.stopSession();
            return false;
        }

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
        if (!this.peerConnection) {
            this.logStatus("DataChannel", "error", "PeerConnection not available");
            this.stopSession();
            return false;
        }

        this.dataChannel = this.peerConnection.createDataChannel("oai-events") ?? null;
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
            if (e instanceof RTCErrorEvent) {
                alert("[DataChannel] Error " + e.error.message);
            } else {
                alert("[DataChannel] Error");
            }
            this.stopSession();
        };

        this.dataChannel.onmessage = (e: MessageEvent) => this.handleDataChannelMessages(e);

        return true;
    }

    private handleDataChannelMessages(e: MessageEvent): void {
        try {
            const msg: RealtimeMessage = JSON.parse(e.data);
            //console.log(msg);
            //console.log(msg.type);

            switch (msg.type) {
                case "session.created":
                    console.log("Session ready");
                    this.handleSessionState(true);
                    this.sessionReady = true;

                    this.initSession();
                    this.sendFileContent();
                    break;

                // errors
                case "invalid_request_error":
                    if (msg.error) this.logStatus("DataChannel", "error", msg.error);
                    this.stopSession();
                    break;

                case "error":
                    const errorMsg = msg.error?.message;
                    if (errorMsg) this.logStatus("DataChannel", "error", errorMsg);
                    this.stopSession();
                    break;

                // other messages
                case "response.content_part.added":
                    if (this.elements) this.elements.modelResponse.textContent = "";
                    break;

                case "response.output_text.delta":
                    if (msg.delta && this.elements) this.elements.modelResponse.textContent += msg.delta;
                    break;

                case "response.output_audio_transcript.delta":
                    if (msg.delta && this.elements) this.elements.modelResponse.textContent += msg.delta;
                    break;

                case "response.output_text.done":
                    console.log("Response: " + msg.text);
                    break;

                case "response.output_audio_transcript.done":
                    console.log("Response: " + msg.transcript);
                    break;

                case "output_audio_buffer.stopped":
                    if (this.flagAudioDisFeedback) this.flagAudioDisFeedback = false;
                    break;

                case "output_audio_buffer.cleared":
                    if (this.flagAudioDisFeedback) this.flagAudioDisFeedback = false;
                    break;

                case "response.done":
                    if (msg.response?.status === "failed") {
                        const error = msg.response.status_details?.error;
                        if (error) this.logStatus("DataChannel", "error", error.message);
                        this.stopSession();
                    }
                    break;

                case "response.function_call_arguments.done": // a function was called
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
            if (!this.peerConnection) {
                this.logStatus("ConnectToModel", "error", "PeerConnection not available");
                this.stopSession();
                return;
            }

            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);

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
            await this.peerConnection.setRemoteDescription(answer);

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

    // send to the model the first, instructive message
    private initSession(): void {
        if (!this.dataChannel) return this.stopSession();

        const config = {
            type: "session.update",
            session: sessionConfig
        }

        this.dataChannel.send(JSON.stringify(config));
    }

    private async getFileData(): Promise<string> {
        try {
            const path = "/Islet/data.json";
            const response = await fetch(path);
            if (!response.ok) throw new Error(`Cannot fetch ${path}`);
            return await response.json();

        } catch (err) {
            console.error(err);
            return "Error retrieving file data.";
        }
    }

    private async getFileTemplate(): Promise<string> {
        try {
            const path = "/Islet/template.png";
            const response = await fetch(path);
            if (!response.ok) throw new Error(`Cannot fetch ${path}`);
            const blob = await response.blob();
            return await imageToBase64(blob);

        } catch (err) {
            console.error(err);
            return "Error retrieving file template.";
        }
    }

    private async getFileColorMap(): Promise<string> {
        try {
            const path = "/Islet/colorMap.png";
            const response = await fetch(path);
            if (!response.ok) throw new Error(`Cannot fetch ${path}`);
            const blob = await response.blob();
            return await imageToBase64(blob);

        } catch (err) {
            console.error(err);
            return "Error retrieving file colorMap.";
        }
    }

    // send the content from the .camio file to the model
    private async sendFileContent(): Promise<void> {
        if (!this.dataChannel) return this.stopSession();

        const dataOutput = JSON.stringify(await this.getFileData()); // json string
        const templateOutput = await this.getFileTemplate(); // base64 string
        const colorMapOutput = await this.getFileColorMap(); // base64 string

        this.sendData(dataOutput);
        await this.sendImage(templateOutput, "template");
        await this.sendImage(colorMapOutput, "colorMap");
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
                        text: `
                            TACTILE DRAWING DATA:
                            The following JSON contains the tactile drawing data.
                            Store it in memory and use it to answer future questions.
                            Never mention where the information come from. Speak as if they were part of your firsthand knowledge.
                            `
                    },
                    {
                        type: "input_text",
                        text: data
                    }
                ]
            }
        }

        this.dataChannel.send(JSON.stringify(res));
        console.warn("data.json file sent to the model");
    }

    private async sendImage(initialBase64Image: string, type: string): Promise<void> {
        if (!this.dataChannel) return this.stopSession();

        let textMsg: string = "";

        if (type === "template") {
            textMsg = `
                    TACTILE DRAWING TEMPLATE IMAGE:
                    - The following image is the tactile drawing itself.
                    - Store it in memory and use it to answer future questions.
                    - Never mention where the information come from. Speak as if they were part of your firsthand knowledge.
                    `;

        } else if (type === "colorMap") {
            textMsg = `
                    TACTILE DRAWING COLOR MAP IMAGE:
                    - The following image represents the color map of the tactile drawing.
                    - Store it in memory and use it to answer questions about hotspot positions.
                    - Never mention where the information come from. Speak as if they were part of your firsthand knowledge.
                    `;
        }

        const finalBase64Image = await this.getSendableImage(initialBase64Image, type);
        //if (finalBase64Image) await showBlobTypeDimSize(base64ToBlob(finalBase64Image), type);

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
                        image_url: finalBase64Image
                    }
                ]
            }
        }

        if (finalBase64Image) {
            this.dataChannel.send(JSON.stringify(res));
            console.warn("Image " + type + " file sent to the model");
        } else console.error("Error: the " + type + " image is too large to be sent");
    }

    private async getSendableImage(initialBase64Image: string, type: string): Promise<string | null> {
        const maxImageSize: number = 220;

        try {
            const blob = base64ToBlob(initialBase64Image);
            //await showBlobTypeDimSize(blob, type);

            const reducedDimBlob = await reduceResolution(blob); // reduce dimensions of the blob
            //await showBlobTypeDimSize(reducedDimBlob, type);
            if (checkBlobSize(reducedDimBlob, maxImageSize)) return await imageToBase64(reducedDimBlob); // send image with reduced dimensions

            const webpBlob = await toWebp(blob); // convert in webp image
            //await showBlobTypeDimSize(webpBlob, type);
            if (checkBlobSize(webpBlob, maxImageSize)) return await imageToBase64(webpBlob); // send webp converted image

            let quality = 0.9;
            while (quality >= 0.0) {
                const compressedBlob = await compressWebpBlob(webpBlob, quality);
                //await showBlobTypeDimSize(compressedBlob, type);
                if (checkBlobSize(compressedBlob, maxImageSize)) return await imageToBase64(compressedBlob); // send webp compressed image

                quality -= 0.1;
            }

            return null;

        } catch (err) {
            console.error("Image compression error:", err);
            return null;
        }
    }

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

        const functionRes = {
            type: "session.update",
            session: {
                type: "realtime",
                output_modalities: ["audio"],
                audio: {
                    output: {
                        voice: "cedar",
                    }
                }
            }
        }

        this.dataChannel.send(JSON.stringify(functionRes));
        this.handleAudioState(true);
        this.dataChannel.send(JSON.stringify({ type: "response.create" }));
    }

    private async disableAudio(): Promise<void> {
        console.warn("Called function disableAudio()");
        if (!this.dataChannel) return this.stopSession();

        const audioDisFeedback = {
            type: "conversation.item.create",
            item: {
                type: "message",
                role: "user",
                content: [
                    {
                        type: "input_text",
                        text: "Translate the phrase “Audio disabled” into the language you were using. Speak the translation exactly as written, without adding or removing any words.",
                    }
                ]
            }
        }

        const functionRes = {
            type: "session.update",
            session: {
                type: "realtime",
                output_modalities: ["text"]
            }
        }

        this.flagAudioDisFeedback = true;
        this.dataChannel.send(JSON.stringify(audioDisFeedback));
        this.dataChannel.send(JSON.stringify({ type: "response.create" }));
        await this.waitForResponse();

        this.dataChannel.send(JSON.stringify(functionRes));
        this.handleAudioState(false);
    }

    private async waitForResponse(): Promise<void> {
        return new Promise(resolve => {
            const check = setInterval(() => {
                if (!this.flagAudioDisFeedback) {
                    clearInterval(check);
                    resolve();
                }
            }, 50);
        });
    }
}
