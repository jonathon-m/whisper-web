import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorker } from "./useWorker";
import { useTranslation } from "react-i18next";
import Constants from "../utils/Constants";

interface ProgressItem {
    file: string;
    loaded: number;
    progress: number;
    total: number;
    name: string;
    status: string;
}

interface TranscriberUpdateData {
    data: {
        text: string;
        chunks: { text: string; timestamp: [number, number | null] }[];
        tps: number;
    };
}

export interface TranscriberData {
    isBusy: boolean;
    tps?: number;
    text: string;
    chunks: { text: string; timestamp: [number, number | null] }[];
}

export interface Transcriber {
    onInputChange: () => void;
    isBusy: boolean;
    isModelLoading: boolean;
    isModelReady: boolean;
    isCheckingModel: boolean;
    progressItems: ProgressItem[];
    downloadModel: () => void;
    start: (audioData: AudioBuffer | undefined) => void;
    output?: TranscriberData;
    model: string;
    setModel: (model: string) => void;
    dtype: string;
    setDtype: (dtype: string) => void;
    gpu: boolean;
    setGPU: (gpu: boolean) => void;
    subtask: string;
    setSubtask: (subtask: string) => void;
    language?: string;
    setLanguage: (language: string) => void;
}

export function useTranscriber(): Transcriber {
    const [transcript, setTranscript] = useState<TranscriberData | undefined>(
        undefined,
    );
    const [isBusy, setIsBusy] = useState(false);
    const [isModelLoading, setIsModelLoading] = useState(false);
    const [isModelReady, setIsModelReady] = useState(false);
    const [isCheckingModel, setIsCheckingModel] = useState(true);

    const [progressItems, setProgressItems] = useState<ProgressItem[]>([]);

    const webWorker = useWorker((event) => {
        const message = event.data;
        // Update the state with the result
        switch (message.status) {
            case "progress":
                // Model file progress: update one of the progress items.
                setProgressItems((prev) =>
                    prev.map((item) => {
                        if (item.file === message.file) {
                            return { ...item, progress: message.progress };
                        }
                        return item;
                    }),
                );
                break;
            case "update":
            case "complete": {
                const busy = message.status === "update";
                const updateMessage = message as TranscriberUpdateData;
                setTranscript({
                    isBusy: busy,
                    text: updateMessage.data.text,
                    tps: updateMessage.data.tps,
                    chunks: updateMessage.data.chunks,
                });
                setIsBusy(busy);
                break;
            }
            case "initiate":
                // Model file start load: add a new progress item to the list.
                setIsModelLoading(true);
                setProgressItems((prev) => [...prev, message]);
                break;
            case "ready":
                setIsModelLoading(false);
                break;
            case "model_ready":
                setIsModelLoading(false);
                setIsModelReady(true);
                setIsCheckingModel(false);
                break;
            case "model_check_complete":
                setIsCheckingModel(false);
                break;
            case "error":
                setIsBusy(false);
                setIsModelLoading(false);
                setIsCheckingModel(false);
                alert(
                    `An error occurred: "${message.data.message}". Please file a bug report.`,
                );
                break;
            case "done":
                // Model file loaded: remove the progress item from the list.
                setProgressItems((prev) =>
                    prev.filter((item) => item.file !== message.file),
                );
                break;

            default:
                // initiate/download/done
                break;
        }
    });

    const { i18n } = useTranslation();

    const [model, setModel] = useState<string>(
        Constants.getDefaultModel(i18n.language),
    );

    const [subtask, setSubtask] = useState<string>(Constants.DEFAULT_SUBTASK);
    const [dtype, setDtype] = useState<string>(Constants.DEFAULT_DTYPE);
    const [gpu, setGPU] = useState<boolean>(Constants.DEFAULT_GPU);
    const [language, setLanguage] = useState<string>(
        Constants.getDefaultLanguage(i18n.language),
    );

    // Check if model is already loaded on initialization
    useEffect(() => {
        console.log("Checking existing model");
        const checkExistingModel = async () => {
            try {
                // Try to get the existing model instance
                webWorker.postMessage({
                    action: "check_model",
                    model,
                    dtype,
                    gpu,
                });
            } catch (error) {
                console.log("Error checking existing model", error);
                console.log("No existing model found");
                setIsCheckingModel(false);
            }
        };

        checkExistingModel();
    }, []); // Only run once on mount

    useEffect(() => {
        setModel(Constants.getDefaultModel(i18n.language));
        setLanguage(Constants.getDefaultLanguage(i18n.language));
        setIsModelReady(false); // Reset model ready state when model changes
    }, [i18n.language]);

    // Reset model ready state when model settings change
    useEffect(() => {
        setIsModelReady(false);
    }, [model, dtype, gpu]);

    const onInputChange = useCallback(() => {
        setTranscript(undefined);
    }, []);

    const downloadModelRequest = useCallback(async () => {
        setIsModelReady(false);
        webWorker.postMessage({
            action: "download_model",
            model,
            dtype,
            gpu,
        });
    }, [webWorker, model, dtype, gpu]);

    const postRequest = useCallback(
        async (audioData: AudioBuffer | undefined) => {
            if (audioData) {
                setTranscript(undefined);
                setIsBusy(true);

                let audio;
                if (audioData.numberOfChannels === 2) {
                    const SCALING_FACTOR = Math.sqrt(2);

                    const left = audioData.getChannelData(0);
                    const right = audioData.getChannelData(1);

                    audio = new Float32Array(left.length);
                    for (let i = 0; i < audioData.length; ++i) {
                        audio[i] = (SCALING_FACTOR * (left[i] + right[i])) / 2;
                    }
                } else {
                    // If the audio is not stereo, we can just use the first channel:
                    audio = audioData.getChannelData(0);
                }

                webWorker.postMessage({
                    action: "transcribe",
                    audio,
                    model,
                    dtype,
                    gpu,
                    subtask: !model.endsWith(".en") ? subtask : null,
                    language:
                        !model.endsWith(".en") && language !== "auto"
                            ? language
                            : null,
                });
            }
        },
        [webWorker, model, dtype, gpu, subtask, language],
    );

    const transcriber = useMemo(() => {
        return {
            onInputChange,
            isBusy,
            isModelLoading,
            isModelReady,
            isCheckingModel,
            progressItems,
            downloadModel: downloadModelRequest,
            start: postRequest,
            output: transcript,
            model,
            setModel,
            dtype,
            setDtype,
            gpu,
            setGPU,
            subtask,
            setSubtask,
            language,
            setLanguage,
        };
    }, [
        onInputChange,
        isBusy,
        isModelLoading,
        isModelReady,
        isCheckingModel,
        progressItems,
        downloadModelRequest,
        postRequest,
        transcript,
        model,
        dtype,
        gpu,
        subtask,
        language,
    ]);

    return transcriber;
}
