import { memo, useState, useEffect } from 'react';
import { Worker, Viewer } from '@react-pdf-viewer/core';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/default-layout/lib/styles/index.css';
import type { PdfNodeData } from '../../types/index.ts';
import { fileApi } from '../../db/apiClient.ts';
import { Loader2, X } from 'lucide-react';

const workerUrl = `https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js`;

interface PdfNodeProps {
    data: PdfNodeData;
    onClose?: () => void;
}

export const PdfNode = memo(function PdfNode({ data, onClose }: PdfNodeProps) {
    const defaultLayoutPluginInstance = defaultLayoutPlugin();
    const [signedUrl, setSignedUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!data.filename) {
            setError('No filename provided');
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        fileApi.getSignedUrl(data.filename)
            .then(({ signedUrl }) => {
                setSignedUrl(signedUrl);
                setLoading(false);
            })
            .catch((err) => {
                setError(err.message);
                setLoading(false);
            });
    }, [data.filename]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full text-slate-400 gap-2">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-sm">加载 PDF 中...</span>
            </div>
        );
    }

    if (error || !signedUrl) {
        return (
            <div className="flex items-center justify-center h-full text-red-400 text-sm">
                PDF 加载失败: {error || 'Unknown error'}
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Header with title and close */}
            {onClose && (
                <div className="flex items-center justify-between px-3 py-1.5 bg-slate-100 border-b border-slate-200 shrink-0">
                    <span className="text-sm font-medium text-slate-700 truncate">{data.title}</span>
                    <button
                        onClick={onClose}
                        className="p-0.5 text-slate-400 hover:text-slate-600 transition-colors"
                        title="关闭"
                    >
                        <X size={16} />
                    </button>
                </div>
            )}
            {/* PDF viewer */}
            <div className="flex-1 overflow-hidden">
                <Worker workerUrl={workerUrl}>
                    <Viewer
                        fileUrl={signedUrl}
                        plugins={[defaultLayoutPluginInstance]}
                        theme="light"
                    />
                </Worker>
            </div>
        </div>
    );
});
