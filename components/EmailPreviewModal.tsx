'use client';

import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface EmailPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  templateId?: string;
  subject?: string;
  body?: string;
  influencerId?: string;
  campaignId?: string;
}

export default function EmailPreviewModal({
  isOpen,
  onClose,
  templateId,
  subject,
  body,
  influencerId,
  campaignId,
}: EmailPreviewModalProps) {
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewSubject, setPreviewSubject] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError('');
    setPreviewHtml('');
    setPreviewSubject('');

    const payload: Record<string, string> = {};
    if (templateId) payload.template_id = templateId;
    if (subject) payload.subject = subject;
    if (body) payload.body = body;
    if (influencerId) payload.influencer_id = influencerId;
    if (campaignId) payload.campaign_id = campaignId;

    fetch(`${API_URL}/api/v1/outreach/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((res) => {
        if (!res.ok) return res.json().then((d) => Promise.reject(d.detail || 'Preview failed'));
        return res.json();
      })
      .then((data) => {
        setPreviewHtml(data.html || '');
        setPreviewSubject(data.subject || '');
      })
      .catch((err) => {
        setError(typeof err === 'string' ? err : 'Failed to load preview');
      })
      .finally(() => setLoading(false));
  }, [isOpen, templateId, subject, body, influencerId, campaignId]);

  useEffect(() => {
    if (iframeRef.current && previewHtml) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(previewHtml);
        doc.close();
      }
    }
  }, [previewHtml]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Email Preview</h2>
            {previewSubject && (
              <p className="text-sm text-gray-500 mt-0.5">Subject: {previewSubject}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden p-4">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              <p className="ml-3 text-gray-500">Generating preview...</p>
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
              {error}
            </div>
          )}
          {!loading && !error && previewHtml && (
            <div className="border border-gray-200 rounded-lg overflow-hidden h-full">
              <div className="bg-gray-100 px-4 py-2 text-xs text-gray-500 border-b border-gray-200 flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-400" />
                  <div className="w-3 h-3 rounded-full bg-yellow-400" />
                  <div className="w-3 h-3 rounded-full bg-green-400" />
                </div>
                <span>Email Preview</span>
              </div>
              <iframe
                ref={iframeRef}
                className="w-full bg-white"
                style={{ height: 'calc(80vh - 160px)', minHeight: '400px' }}
                sandbox="allow-same-origin"
                title="Email Preview"
              />
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}