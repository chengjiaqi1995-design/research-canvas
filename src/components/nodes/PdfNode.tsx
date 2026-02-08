import { memo, useState, useEffect } from 'react';
import { Worker, Viewer } from '@react-pdf-viewer/core';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/default-layout/lib/styles/index.css';
import type { PdfNodeData } from '../../types/index.ts';
import { Loader2 } from 'lucide-react';

const workerUrl = `https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js`;

// Get auth token from localStorage (same logic as apiClient)
function getToken(): string | null {
    try {
        const stored = localStorage.getItem('rc_auth_user');
        if (stored) {
            const parsed = JSON.parse(stored);
            return parsed._credential || null;
        }
    } catch {
        // ignore
    }
    return null;
}

interface PdfNodeProps {
    data: PdfNodeData;
}

export const PdfNode = memo(function PdfNode({ data }: PdfNodeProps) {
    const defaultLayoutPluginInstance = defaultLayoutPlugin();
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!data.url) {
            setError('No PDF URL');
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        const token = getToken();
        // data.url is already in '/api/files/...' format, nginx proxies /api/ to backend
        const fullUrl = data.url;

        fetch(fullUrl, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                return res.blob();
            })
            .then((blob) => {
                const url = URL.createObjectURL(blob);
                setBlobUrl(url);
                setLoading(false);
            })
            .catch((err) => {
                setError(err.message);
                setLoading(false);
            });

        // Cleanup blob URL on unmount
        return () => {
            setBlobUrl((prev) => {
                if (prev) URL.revokeObjectURL(prev);
                return null;
            });
        };
    }, [data.url]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full text-slate-400 gap-2">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-sm">加载 PDF 中...</span>
            </div>
        );
    }

    if (error || !blobUrl) {
        return (
            <div className="flex items-center justify-center h-full text-red-400 text-sm">
                PDF 加载失败: {error || 'Unknown error'}
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-hidden">
                <Worker workerUrl={workerUrl}>
                    <Viewer
                        fileUrl={blobUrl}
                        plugins={[defaultLayoutPluginInstance]}
                        theme="light"
                    />
                </Worker>
            </div>
        </div>
    );
});
