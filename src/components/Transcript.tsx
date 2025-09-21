import { useRef, useEffect, useState } from "react";

import { TranscriberData } from "../hooks/useTranscriber";
import { formatAudioTimestamp, formatSrtTimeRange } from "../utils/AudioUtils";
import { t } from "i18next";

interface Props {
    transcribedData: TranscriberData | undefined;
    audioData?: {
        buffer: AudioBuffer;
        url: string;
        source: string;
        mimeType: string;
    };
}

export default function Transcript({ transcribedData, audioData }: Props) {
    const divRef = useRef<HTMLDivElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const [playingChunk, setPlayingChunk] = useState<number | null>(null);
    const [editedChunks, setEditedChunks] = useState<{ [key: number]: string }>({});
    const [editingChunk, setEditingChunk] = useState<number | null>(null);

    // Initialize edited chunks when transcribedData changes
    useEffect(() => {
        if (transcribedData?.chunks) {
            const initialEditedChunks: { [key: number]: string } = {};
            transcribedData.chunks.forEach((chunk, index) => {
                initialEditedChunks[index] = chunk.text;
            });
            setEditedChunks(initialEditedChunks);
        }
    }, [transcribedData?.chunks]);

    const saveBlob = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    };

    const getChunkText = (chunkIndex: number) => {
        return editedChunks[chunkIndex] ?? transcribedData?.chunks[chunkIndex]?.text ?? "";
    };

    const isChunkEdited = (chunkIndex: number) => {
        const originalText = transcribedData?.chunks[chunkIndex]?.text ?? "";
        const editedText = editedChunks[chunkIndex] ?? originalText;
        return originalText !== editedText;
    };

    const exportTXT = () => {
        const chunks = transcribedData?.chunks ?? [];
        const text = chunks
            .map((_, i) => getChunkText(i))
            .join("")
            .trim();

        const blob = new Blob([text], { type: "text/plain" });
        saveBlob(blob, "transcript.txt");
    };

    const exportJSON = () => {
        const chunks = transcribedData?.chunks ?? [];
        const editedChunksData = chunks.map((chunk, i) => ({
            ...chunk,
            text: getChunkText(i)
        }));

        let jsonData = JSON.stringify(editedChunksData, null, 2);

        // post-process the JSON to make it more readable
        const regex = /( {4}"timestamp": )\[\s+(\S+)\s+(\S+)\s+\]/gm;
        jsonData = jsonData.replace(regex, "$1[$2 $3]");

        const blob = new Blob([jsonData], { type: "application/json" });
        saveBlob(blob, "transcript.json");
    };

    const exportSRT = () => {
        const chunks = transcribedData?.chunks ?? [];
        let srt = "";
        for (let i = 0; i < chunks.length; i++) {
            srt += `${i + 1}\n`;
            // TODO - Check why 2nd timestamp is number | null
            srt += `${formatSrtTimeRange(chunks[i].timestamp[0], chunks[i].timestamp[1] ?? chunks[i].timestamp[0])}\n`;
            srt += `${getChunkText(i)}\n\n`;
        }
        const blob = new Blob([srt], { type: "text/plain" });
        saveBlob(blob, "transcript.srt");
    };

    const exportButtons = [
        { name: "TXT", onClick: exportTXT },
        { name: "JSON", onClick: exportJSON },
        { name: "SRT", onClick: exportSRT },
    ];

    const endOfMessagesRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        endOfMessagesRef.current?.scrollIntoView({ behavior: "auto" });
    }, [transcribedData?.chunks]);

    const playChunk = (chunkIndex: number) => {
        if (!audioData || !audioRef.current) return;

        const chunk = transcribedData?.chunks[chunkIndex];
        if (!chunk) return;

        const startTime = chunk.timestamp[0];
        const endTime = chunk.timestamp[1] ?? chunk.timestamp[0];

        // Set the audio source and current time
        audioRef.current.src = audioData.url;
        audioRef.current.currentTime = startTime;
        
        // Play the audio
        audioRef.current.play();
        setPlayingChunk(chunkIndex);

        // Stop playing when we reach the end time
        const handleTimeUpdate = () => {
            if (audioRef.current && audioRef.current.currentTime >= endTime) {
                audioRef.current.pause();
                setPlayingChunk(null);
                audioRef.current.removeEventListener('timeupdate', handleTimeUpdate);
            }
        };

        audioRef.current.addEventListener('timeupdate', handleTimeUpdate);
    };

    const stopPlaying = () => {
        if (audioRef.current) {
            audioRef.current.pause();
            setPlayingChunk(null);
        }
    };

    const handleTextChange = (chunkIndex: number, newText: string) => {
        setEditedChunks(prev => ({
            ...prev,
            [chunkIndex]: newText
        }));
    };

    const handleTextBlur = () => {
        setEditingChunk(null);
    };

    const handleKeyDown = (e: React.KeyboardEvent, chunkIndex: number) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            setEditingChunk(null);
        }
        if (e.key === 'Escape') {
            // Reset to original text
            const originalText = transcribedData?.chunks[chunkIndex]?.text ?? "";
            setEditedChunks(prev => ({
                ...prev,
                [chunkIndex]: originalText
            }));
            setEditingChunk(null);
        }
    };

    return (
        <>
            {/* Hidden audio element for playback control */}
            <audio ref={audioRef} style={{ display: 'none' }} />
            
            <div
                ref={divRef}
                className='w-full flex flex-col mt-2 p-4 overflow-y-auto'
            >
                {transcribedData?.chunks &&
                    transcribedData.chunks.map((chunk, i) => (
                        <div
                            key={`${i}-${chunk.text}`}
                            className={`w-full flex flex-row mb-2 ${transcribedData?.isBusy ? "bg-gray-100" : "bg-white"} rounded-lg p-4 shadow-xl shadow-black/5 ring-1 ring-slate-700/10 ${isChunkEdited(i) ? "ring-2 ring-blue-400" : ""}`}
                        >
                            <div className='mr-5 flex-shrink-0'>
                                {formatAudioTimestamp(chunk.timestamp[0])}
                            </div>
                            <div className='flex-grow relative'>
                                {editingChunk === i ? (
                                    <textarea
                                        value={getChunkText(i)}
                                        onChange={(e) => handleTextChange(i, e.target.value)}
                                        onBlur={() => handleTextBlur()}
                                        onKeyDown={(e) => handleKeyDown(e, i)}
                                        className="w-full p-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        rows={Math.max(1, Math.ceil(getChunkText(i).length / 50))}
                                        autoFocus
                                    />
                                ) : (
                                    <div
                                        onClick={() => setEditingChunk(i)}
                                        className={`cursor-text hover:bg-gray-50 p-2 rounded-md transition-colors ${isChunkEdited(i) ? "bg-blue-50" : ""}`}
                                        title="Click to edit"
                                    >
                                        {getChunkText(i)}
                                        {isChunkEdited(i) && (
                                            <span className="ml-2 text-xs text-blue-600 font-medium">
                                                (edited)
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                            {audioData && (
                                <div className='ml-4 flex-shrink-0'>
                                    {playingChunk === i ? (
                                        <button
                                            onClick={stopPlaying}
                                            className='w-6 h-6 flex items-center justify-center rounded-full bg-red-500 hover:bg-red-600 text-white transition-colors'
                                            title="Stop playing"
                                        >
                                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                                <rect x="6" y="6" width="8" height="8" />
                                            </svg>
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => playChunk(i)}
                                            className='w-6 h-6 flex items-center justify-center rounded-full bg-green-500 hover:bg-green-600 text-white transition-colors'
                                            title="Play this segment"
                                        >
                                            <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 20 20">
                                                <polygon points="6,4 6,16 14,10" />
                                            </svg>
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                {transcribedData && !transcribedData.isBusy && (
                    <div className='w-full text-center'>
                        {exportButtons.map((button, i) => (
                            <button
                                key={i}
                                onClick={button.onClick}
                                className='text-white bg-green-500 hover:bg-green-600 focus:ring-4 focus:ring-green-300 font-medium rounded-lg text-sm px-4 py-2 text-center mr-2 dark:bg-green-600 dark:hover:bg-green-700 dark:focus:ring-green-800 inline-flex items-center'
                            >
                                {t("transcript.export")} {button.name}
                            </button>
                        ))}
                    </div>
                )}
                {transcribedData?.tps && (
                    <p className='text-sm text-center mt-4'>
                        <span className='font-semibold text-black'>
                            {transcribedData?.tps.toFixed(2)}
                        </span>{" "}
                        <span className='text-gray-500'>
                            {t("transcript.tokens_per_second")}
                        </span>
                    </p>
                )}
                <div ref={endOfMessagesRef} />
            </div>
        </>
    );
}
