'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { CatalogSettings } from '@/lib/catalog/model';

interface SavedCatalog {
  settings: CatalogSettings;
  taxonomyRevision: string;
}

export function useCatalogAutosave({
  settings,
  savedValue,
  valueOf,
  paused,
  action,
  revision,
  onSaved,
}: {
  settings: CatalogSettings | null;
  savedValue: string;
  valueOf: (settings: CatalogSettings) => string;
  paused: boolean;
  action: 'save' | 'save-taxonomy';
  revision?: string;
  onSaved: (data: SavedCatalog, submitted: CatalogSettings) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{
    value: string;
    message: string;
  } | null>(null);
  const value = settings ? valueOf(settings) : '';
  const error = failure?.value === value ? failure.message : '';
  const latest = useRef({
    settings,
    revision,
    onSaved,
    paused,
    action,
    valueOf,
    error,
  });
  latest.current = {
    settings,
    revision,
    onSaved,
    paused,
    action,
    valueOf,
    error,
  };
  const inFlight = useRef(false);
  const persisted = useRef(savedValue);
  const savedFromProps = useRef(savedValue);
  if (savedFromProps.current !== savedValue) {
    persisted.current = savedValue;
    savedFromProps.current = savedValue;
  }
  const nextRevision = useRef(revision);
  useEffect(() => {
    nextRevision.current = revision;
  }, [revision]);
  const mounted = useRef(false);
  const persist = useCallback(async function persistDraft() {
    const current = latest.current;
    const submitted = current.settings;
    if (!submitted || current.paused || current.error || inFlight.current)
      return;
    const submittedValue = current.valueOf(submitted);
    if (submittedValue === persisted.current) return;
    inFlight.current = true;
    if (mounted.current) setSaving(true);
    let succeeded = false;
    try {
      const body = JSON.stringify({
        action: current.action,
        ...(current.action === 'save'
          ? { scope: 'collection' }
          : { expectedRevision: nextRevision.current }),
        settings: submitted,
      });
      const response = await fetch('/api/admin/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: new Blob([body]).size < 60000,
        body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '自动保存失败，请重试');
      persisted.current = current.valueOf(data.settings);
      nextRevision.current = data.taxonomyRevision;
      succeeded = true;
      if (mounted.current) {
        latest.current.onSaved(data, submitted);
        setFailure(null);
      }
    } catch (reason) {
      if (mounted.current)
        setFailure({
          value: submittedValue,
          message: (reason as Error).message,
        });
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
      // A navigation can unmount the form while its last request is in flight.
      // Finish any newer committed edit using the revision returned by that request.
      else if (
        succeeded &&
        latest.current.settings &&
        current.valueOf(latest.current.settings) !== submittedValue
      )
        void persistDraft();
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const flush = () => {
      void persist();
    };
    window.addEventListener('pagehide', flush);
    return () => {
      mounted.current = false;
      window.removeEventListener('pagehide', flush);
      void persist();
    };
  }, [persist]);
  const dirty = !!settings && savedValue !== value;
  useEffect(() => {
    if (!dirty || paused || saving || error) return;
    const timer = setTimeout(() => void persist(), 400);
    return () => clearTimeout(timer);
  }, [dirty, error, paused, persist, savedValue, saving, value]);
  return { dirty, saving, error, retry: () => setFailure(null) };
}
