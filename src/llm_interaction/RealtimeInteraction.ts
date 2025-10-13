import sessionConfig from "./sessionConfig";

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
        if (!this.elements) {
            console.error("UI elements not initialized");
            return;
        }

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
        if (!this.elements) {
            console.error("UI elements not initialized");
            return;
        }

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
        if (!this.elements) {
            console.error("UI elements not initialized");
            return;
        }

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
            console.error("Data not sent: buffered amount:", this.dataChannel?.bufferedAmount + " bytes"); // data not sent
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
        if (!this.dataChannel) {
            this.stopSession();
            return;
        }

        const config = {
            type: "session.update",
            session: sessionConfig
        }

        this.dataChannel.send(JSON.stringify(config));
    }

    private async getFileData(): Promise<string> {
        try {
            const path = "/House_with_rainbow/data.json";
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
            const path = "/House_with_rainbow/template.png";
            const response = await fetch(path);
            if (!response.ok) throw new Error(`Cannot fetch ${path}`);
            const blob = await response.blob();

            return await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });

        } catch (err) {
            console.error(err);
            return "Error retrieving file template.";
        }
    }

    private async getFileColorMap(): Promise<string> {
        try {
            const path = "/House_with_rainbow/colorMap.png";
            const response = await fetch(path);
            if (!response.ok) throw new Error(`Cannot fetch ${path}`);
            const blob = await response.blob();

            return await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });

        } catch (err) {
            console.error(err);
            return "Error retrieving file colorMap.";
        }
    }

    private getBase64Size(base64String: string): number {
        const bytes = Math.ceil((base64String.length * 3) / 4);
        const kb = bytes / 1024;
        return kb;
    }

    private checkBase64Size(base64String: string): boolean {
        const max_size = 220; // kb
        const stringSize = this.getBase64Size(base64String);

        if (stringSize > max_size) return false;
        else return true;
    }

    // send the content from the .camio file to the model
    private async sendFileContent(): Promise<void> {
        if (!this.dataChannel) {
            this.stopSession();
            return;
        }

        const dataOutput = JSON.stringify(await this.getFileData()); // json string
        const templateOutput = await this.getFileTemplate(); // base64 string
        const colorMapOutput = await this.getFileColorMap(); // base64 string

        const dataRes = {
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
                            The color associated with each hotspot is not the color of the drawing, but is used to identify the location of the hotspot with the colorMap.
                            If you are asked for the color of the hotspot, do not respond with the one indicated in the "color" field of the json file, but with what is indicated in the hotspot description (if present, otherwise respond saying that you don't have this information).
                            `
                    },
                    {
                        type: "input_text",
                        text: dataOutput
                    }
                ]
            }
        }

        const templateRes = {
            type: "conversation.item.create",
            item: {
                type: "message",
                role: "user",
                content: [
                    {
                        type: "input_text",
                        text: `
                            TACTILE DRAWING TEMPLATE IMAGE:
                            The following image is the tactile drawing itself.
                            Store it in memory and use it to answer future questions.
                            `
                    },
                    {
                        type: "input_image",
                        image_url: templateOutput
                    }
                ]
            }
        }

        const colorMapRes = {
            type: "conversation.item.create",
            item: {
                type: "message",
                role: "user",
                content: [
                    {
                        type: "input_text",
                        text: `
                            TACTILE DRAWING COLOR MAP IMAGE:
                            The following image represents the color map of the tactile drawing.
                            Each color corresponds to a hotspot, indicating its location in the drawing.
                            Store it in memory and use it to answer questions about hotspot positions.
                            Do not confuse it with the tactile drawing image.
                            The color associated with each hotspot is not the color of the drawing, but is used to identify the location of the hotspot.
                            `
                    },
                    {
                        type: "input_image",
                        image_url: colorMapOutput
                    }
                ]
            }
        }

        this.dataChannel.send(JSON.stringify(dataRes));
        console.warn("data.json file sent to the model");

        this.dataChannel.send(JSON.stringify(templateRes));
        console.warn("image template file sent to the model");

        this.dataChannel.send(JSON.stringify(colorMapRes));
        console.warn("image color map file sent to the model");
/*
        if (this.checkBase64Size(templateOutput)) {
            this.dataChannel.send(JSON.stringify(templateRes));
            console.warn("image template file sent to the model");
        } else console.error("Error: the template image is too large to be sent");

        if (this.checkBase64Size(colorMapOutput)) {
            this.dataChannel.send(JSON.stringify(colorMapRes));
            console.warn("image color map file sent to the model");
        } else console.error("Error: the color map image is too large to be sent");*/
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
        if (!this.dataChannel) {
            this.stopSession();
            return;
        }

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
        if (!this.dataChannel) {
            this.stopSession();
            return;
        }

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