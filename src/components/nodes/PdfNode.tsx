import { memo } from 'react';
import { Worker, Viewer } from '@react-pdf-viewer/core';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/default-layout/lib/styles/index.css';
import type { PdfNodeData } from '../../types/index.ts';

// Use standard CDN for pdfjs worker to avoid build/bundling complexity
const workerUrl = `https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js`;

interface PdfNodeProps {
    data: PdfNodeData;
    width?: string | number;
    height?: string | number;
}

export const PdfNode = memo(function PdfNode({ data, width = '100%', height = '100%' }: PdfNodeProps) {
    const defaultLayoutPluginInstance = defaultLayoutPlugin();

    return (
        <div style={{ width, height, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {/* Toolbar area is handled by defaultLayoutPlugin */}
            <div className="flex-1 overflow-hidden bg-slate-100 relative">
                <Worker workerUrl={workerUrl}>
                    <Viewer
                        fileUrl={data.url}
                        plugins={[defaultLayoutPluginInstance]}
                        theme="light"
                    />
                </Worker>
            </div>
        </div>
    );
});
