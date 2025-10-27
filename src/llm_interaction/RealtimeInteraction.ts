import { getEphemeralKey } from "../ephemeralKey/getEphemeralKey";
import createSessionConfig from "./sessionConfig";
import {
    imageToBase64,
    base64ToBlob,
    showBlobTypeDimSize,
    checkBlobSize,
    toWebp,
    reduceResolution,
    getImgDimensions,
    compressWebpBlob,
    drawPointedPosition,
    mapLangCodeToName
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
    coordContainer: HTMLElement;
    xCoord: HTMLInputElement;
    yCoord: HTMLInputElement;
    imgTemplateContainer: HTMLElement;
}

export class RealtimeInteraction {
    private static instance: RealtimeInteraction | null = null;

    private peerConnection: RTCPeerConnection | null = null;
    private audioElement: HTMLAudioElement | null = null;
    private localStream: MediaStream | null = null;
    private dataChannel: RTCDataChannel | null = null;

    private ephemeralKey: string | null = null;
    private elements: UIElements | null = null;

    private audioResponsesOn: boolean = false;

    private finalBase64Template: string | null = null;
    private lastPointedPosition: { lastX: number | null, lastY: number | null } = { lastX: 10000, lastY: 10000 }; // 10000 are placeholders that are changed when session starts

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

    public init(): void {
        this.initializeUIElements();
        if (!this.elements) return console.error("UI elements not initialized");

        this.elements.startBtn.onclick = () => this.startSession();
        this.elements.stopBtn.onclick = () => this.stopSession();

        this.elements.xCoord.oninput = async () => {
            this.enforceInputMinMax(this.elements!.xCoord);
            this.updateImageView();
        };
        this.elements.yCoord.oninput = () => {
            this.enforceInputMinMax(this.elements!.yCoord);
            this.updateImageView();
        };

        this.handleSessionState(false);
        this.handleAudioState(false);
    }

    private initializeUIElements(): void {
        this.elements = {
            startBtn: document.getElementById("startBtn") as HTMLButtonElement,
            stopBtn: document.getElementById("stopBtn") as HTMLButtonElement,
            sessionState: document.getElementById("sessionState") as HTMLElement,
            audioState: document.getElementById("audioState") as HTMLElement,
            modelResponse: document.getElementById("modelResponse") as HTMLElement,
            coordContainer: document.getElementById("coordContainer") as HTMLElement,
            xCoord: document.getElementById("xCoord") as HTMLInputElement,
            yCoord: document.getElementById("yCoord") as HTMLInputElement,
            imgTemplateContainer: document.getElementById("imgTemplateContainer") as HTMLElement
        }
    }

    // -----------------
    // SESSION HANDLING
    // -----------------

    private async startSession(): Promise<void> {
        this.ephemeralKey = await getEphemeralKey();
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

        console.log("Session closed");
        this.handleSessionState(false);
        this.handleAudioState(false);
    }

    // ------------
    // UI HANDLING
    // ------------

    private handleSessionState(state: boolean): void {
        if (!this.elements) return console.error("UI elements not initialized");

        if (state) {
            this.elements.coordContainer.hidden = false;

            this.elements.sessionState.textContent = "Session on";
            this.elements.sessionState.classList.add("stateOn");
            this.elements.sessionState.classList.remove("stateOff");
            this.elements.startBtn.disabled = true;
            this.elements.stopBtn.disabled = false;

        } else {
            this.elements.coordContainer.hidden = true;
            this.elements.xCoord.value = "";
            this.elements.yCoord.value = "";

            this.elements.imgTemplateContainer.hidden = true;
            this.elements.imgTemplateContainer.innerHTML = "";

            this.elements.modelResponse.textContent = "The model response will appear here...";

            this.elements.sessionState.textContent = "Session off";
            this.elements.sessionState.classList.add("stateOff");
            this.elements.sessionState.classList.remove("stateOn");
            this.elements.startBtn.disabled = false;
            this.elements.stopBtn.disabled = true;

            this.finalBase64Template = null;
        }
    }

    private handleAudioState(state: boolean): void {
        if (!this.elements) return console.error("UI elements not initialized");

        if (state) {
            this.audioResponsesOn = true;
            this.elements.audioState.textContent = "Audio on";
            this.elements.audioState.classList.remove("stateDisabled");
            this.elements.audioState.classList.add("stateEnabled");

        } else {
            this.audioResponsesOn = false;
            this.elements.audioState.textContent = "Audio off";
            this.elements.audioState.classList.add("stateDisabled");
            this.elements.audioState.classList.remove("stateEnabled");
        }
    }

    private async setInputCoordsMaxLimits(base64Img: string): Promise<void> {
        if (!this.elements) return console.error("UI elements not initialized");

        const { x, y } = await getImgDimensions(base64Img);
        this.elements.xCoord.max = x.toString();
        this.elements.yCoord.max = y.toString();
    }

    private enforceInputMinMax(input: HTMLInputElement): void {
        const max = parseInt(input.max);
        const min = parseInt(input.min);
        let value = input.valueAsNumber;

        if (isNaN(value)) return;

        if (value > max) value = max;
        if (value < min) value = min;

        input.valueAsNumber = value;
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
            if (e instanceof RTCErrorEvent) {
                console.error("[DataChannel] Error", e.error.message);
            } else {
                console.error("[DataChannel] Error", e);
            }
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
                    console.log("Session ready");
                    this.handleSessionState(true);

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

                // handle audio input
                case "input_audio_buffer.committed":
                    await this.sendPointedPositionIfNecessary();
                    this.dataChannel!.send(JSON.stringify({ type: "response.create" }));
                    break;

                // transcription of the text response in the UI
                case "response.content_part.added":
                    if (this.elements) this.elements.modelResponse.textContent = "";
                    break;

                case "response.output_text.delta":
                    if (msg.delta && this.elements) this.elements.modelResponse.textContent += msg.delta;
                    break;

                case "response.output_audio_transcript.delta":
                    if (msg.delta && this.elements) this.elements.modelResponse.textContent += msg.delta;
                    break;

                // transcription of the text response in console
                case "response.output_text.done":
                    console.log("Response: " + msg.text);
                    break;

                case "response.output_audio_transcript.done":
                    console.log("Response: " + msg.transcript);
                    break;

                // response done
                case "response.done":
                    if (msg.response?.status === "failed") {
                        const error = msg.response.status_details?.error;
                        if (error) this.logStatus("DataChannel", "error", error.message);
                        this.stopSession();
                    }
                    break;

                // function calls
                case "response.function_call_arguments.done":
                    this.handleFunctionCalls(msg);
                    break;
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

    // --------------------
    // SEND INITIAL PROMPT
    // --------------------

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
    }

    // -------------------------
    // SEND .CAMIO FILE CONTENT
    // -------------------------

    private async getFileData(): Promise<any> {
        const path = "/Islet/data.json";
        const response = await fetch(path);
        if (!response.ok) throw new Error(`Cannot fetch ${path}`);
        return await response.json();
    }

    private async getFileTemplate(): Promise<string> {
        const path = "/Islet/template.png";
        const response = await fetch(path);
        if (!response.ok) throw new Error(`Cannot fetch ${path}`);
        const blob = await response.blob();
        return await imageToBase64(blob);
    }

    private async getFileColorMap(): Promise<string> {
        const path = "/Islet/colorMap.png";
        const response = await fetch(path);
        if (!response.ok) throw new Error(`Cannot fetch ${path}`);
        const blob = await response.blob();
        return await imageToBase64(blob);
    }

    private async sendFileContent(): Promise<void> {
        if (!this.dataChannel) return this.stopSession();

        try {
            const dataOutput = JSON.stringify(await this.getFileData()); // json string
            const templateOutput = await this.getFileTemplate(); // base64 string
            const colorMapOutput = await this.getFileColorMap(); // base64 string

            this.sendData(dataOutput);

            const finalTemplateOutput = await this.getSendableImage(templateOutput);
            const finalColorMapOutput = await this.getSendableImage(colorMapOutput);

            if (!finalTemplateOutput) throw new Error("The template image is too large to be sent");
            if (!finalColorMapOutput) throw new Error("The color map image is too large to be sent");

            if (finalTemplateOutput) {
                this.finalBase64Template = finalTemplateOutput;
                await this.sendImage(finalTemplateOutput, "template");
                this.setInputCoordsMaxLimits(finalTemplateOutput);
                await this.updateImageView();
            }
            if (finalColorMapOutput) await this.sendImage(finalColorMapOutput, "colorMap");

        } catch (err) {
            console.error("Failed to prepare or send file content:", err);
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

    private async getSendableImage(initialBase64Image: string): Promise<string | null> {
        const maxImageSize: number = 220;

        try {
            const blob = base64ToBlob(initialBase64Image);

            const reducedDimBlob = await reduceResolution(blob); // reduce dimensions of the blob
            if (checkBlobSize(reducedDimBlob, maxImageSize)) return await imageToBase64(reducedDimBlob); // send image with reduced dimensions

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

    private async sendImage(base64Image: string, type: string): Promise<void> {
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
        console.warn("Image " + type + " file sent to the model");
    }

    // --------------
    // UI IMAGE VIEW
    // --------------

    private showImage(base64Img: string): void {
        if (!this.elements) return console.error("UI elements not initialized");

        this.elements.imgTemplateContainer.innerHTML = "";

        const img = document.createElement("img");
        img.src = base64Img;
        img.classList.add("imgTemplate");
        this.elements.imgTemplateContainer.appendChild(img);

        this.elements.imgTemplateContainer.hidden = false;
    }

    private async updateImageView(): Promise<void> {
        if (!this.elements) return console.error("UI elements not initialized");
        if (!this.finalBase64Template) return;

        const x = Number.isNaN(this.elements.xCoord.valueAsNumber) ? null : this.elements.xCoord.valueAsNumber;
        const y = Number.isNaN(this.elements.yCoord.valueAsNumber) ? null : this.elements.yCoord.valueAsNumber;

        const newImageView = await drawPointedPosition(this.finalBase64Template, x, y);
        this.showImage(newImageView);
    }

    // ---------------
    // FUNCTION CALLS
    // ---------------

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
                    input: [
                        {
                            type: "message",
                            role: "user",
                            content: [
                                {
                                    type: "input_text",
                                    text: "Audio already enabled."
                                }
                            ]
                        }
                    ],
                }
            }
            this.dataChannel.send(JSON.stringify(audioAlreadyEnabled));
            return;
        }

        const enableAudioOutput = {
            type: "session.update",
            session: {
                type: "realtime",
                output_modalities: ["audio"],
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
                    instructions: "Do not call any function. Notify the user that audio is already disabled. Keep the response very short."
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
                output_modalities: ["audio"],
                instructions: "Do not call any function. Notify the user that audio has been disabled. Keep the response very short."
            }
        }

        this.dataChannel.send(JSON.stringify(audioDisFeedback));
    }

    // ----------------------
    // USER POINTED POSITION
    // ----------------------

    private async sendPointedPositionIfNecessary(): Promise<void> {
        try {
            const { x: currentX, y: currentY } = this.getCurrentPointedPosition();
            const { x: lastX, y: lastY } = this.getLastPointedPosition();
            const positionChanged = this.checkPointedPositionVariation(currentX, currentY, lastX, lastY);

            if (positionChanged) {
                this.lastPointedPosition = { lastX: currentX, lastY: currentY };
                await this.sendPointedPositionImage(currentX, currentY);
            }

        } catch (err) {
            if (err) console.error(err);
            this.stopSession();
        }
    }

    private getCurrentPointedPosition(): { x: number | null, y: number | null } {
        if (!this.elements) throw new Error("UI elements not initialized");
        if (!this.finalBase64Template) throw new Error("Image template missing");

        const x = Number.isNaN(this.elements.xCoord.valueAsNumber) ? null : this.elements.xCoord.valueAsNumber;
        const y = Number.isNaN(this.elements.yCoord.valueAsNumber) ? null : this.elements.yCoord.valueAsNumber;

        return { x, y };
    }

    private getLastPointedPosition(): { x: number | null, y: number | null } {
        if (!this.finalBase64Template) throw new Error("Image template missing");
        const { lastX: x, lastY: y } = this.lastPointedPosition;
        return { x, y };
    }

    private checkPointedPositionVariation(
        currentX: number | null,
        currentY: number | null,
        lastX: number | null,
        lastY: number | null,
        threshold: number = 5 // pixel
    ): boolean {
        // if even just one of the two coordinates is null, it means that the user is not pointing
        const currNull = currentX === null || currentY === null;
        const lastNull = lastX === null || lastY === null;

        // the user was not pointing before and is not pointing now --> no change
        if (currNull && lastNull) {
            return false;
        }

        // the user was not pointing before, but is pointing now --> change
        if (!currNull && lastNull) {
            return true;
        }

        // the user was pointing before, but is not pointing now --> change
        if (currNull && !lastNull) {
            return true;
        }

        // the user was pointing before and is pointing now --> threshold control
        const diffX = Math.abs(currentX! - lastX!);
        const diffY = Math.abs(currentY! - lastY!);
        return diffX >= threshold || diffY >= threshold;
    }

    private async sendPointedPositionImage(currentX: number | null, currentY: number | null): Promise<void> {
        if (!this.finalBase64Template) throw new Error("Image template missing");
        if (!this.dataChannel) throw new Error("Data channel missing");

        let textMsg = "";

        if (currentX === null || currentY === null) {
            textMsg = `
                    THE USER IS NOT POINTING ANY POSITION:
                    The following image represents the EMPTY template, without the position pointed by the user.
                    `
        } else {
            textMsg = `
                    USER POINTED POSITION:
                    Follows the image representing the position.
                    `
        }

        const imgWithPosition = await drawPointedPosition(this.finalBase64Template, currentX, currentY);

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
                        image_url: imgWithPosition
                    }
                ]
            }
        }

        this.dataChannel.send(JSON.stringify(res));
        console.log("User pointed position sent to the model");
    }
}
