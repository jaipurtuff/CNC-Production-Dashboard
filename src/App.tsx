import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { HomeDashboard } from './components/HomeDashboard';
import { CncFilesView } from './components/CncFilesView';
import { WorkOrdersTable } from './components/WorkOrdersTable';
import { TraceabilityView } from './components/TraceabilityView';
import { CncFileInspector } from './components/CncFileInspector';
import { VerificationTestBench } from './components/VerificationTestBench';
import { JobTimelineModal } from './components/JobTimelineModal';
import { CncStatus, OrderSyncStatus, DailyProductionSummary } from './types';
import { safeFetchJson } from './lib/api';

export default function App() {
  const [activeTab, setActiveTab] = useState<'production' | 'files' | 'orders' | 'traceability' | 'inspector' | 'tests'>('production');
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [isPolling, setIsPolling] = useState<boolean>(false);

  const [cncStatus, setCncStatus] = useState<CncStatus | null>(null);
  const [orderSync, setOrderSync] = useState<OrderSyncStatus | null>(null);
  const [dailySummary, setDailySummary] = useState<DailyProductionSummary | null>(null);

  const [inspectedJobId, setInspectedJobId] = useState<string | null>(null);
  const [traceabilityWo, setTraceabilityWo] = useState<string>('');

  // Lightweight polling for Live Production view only
  const fetchLiveDashboardData = useCallback(async () => {
    setIsPolling(true);
    try {
      // 1. CNC Machine Status & Current Active Job (lightweight query)
      const { data: statusData } = await safeFetchJson<{
        cnc: CncStatus;
        orderSync: OrderSyncStatus;
      }>('/api/status');
      if (statusData) {
        if (statusData.cnc) setCncStatus(statusData.cnc);
        if (statusData.orderSync) setOrderSync(statusData.orderSync);
      }

      // 2. Daily metrics for selected date (server-side PostgreSQL aggregation)
      const { data: dailyData } = await safeFetchJson<DailyProductionSummary>(
        `/api/production/daily?date=${selectedDate}`
      );
      if (dailyData) {
        setDailySummary(dailyData);
      }

      setLastUpdated(new Date());
    } catch (err) {
      console.warn('Dashboard poll cycle warning:', err);
    } finally {
      setIsPolling(false);
    }
  }, [selectedDate]);

  // Polling cycle: Only poll live telemetry every 4 seconds
  useEffect(() => {
    fetchLiveDashboardData();
    const interval = setInterval(fetchLiveDashboardData, 4000);
    return () => clearInterval(interval);
  }, [fetchLiveDashboardData]);

  const handleSelectWo = (woNo: string) => {
    setTraceabilityWo(woNo);
    setActiveTab('traceability');
  };

  const handleInspectJob = (jobId: string) => {
    setInspectedJobId(jobId);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Industrial Header & Status */}
      <Navbar
        cncStatus={cncStatus}
        orderSync={orderSync}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        lastUpdated={lastUpdated}
        isPolling={isPolling}
      />

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Tab 1: Clean Redesigned Operational Home Dashboard */}
        {activeTab === 'production' && (
          <HomeDashboard
            status={cncStatus}
            dailySummary={dailySummary}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            lastUpdated={lastUpdated}
            onInspectJob={handleInspectJob}
            onNavigateToFiles={() => setActiveTab('files')}
          />
        )}

        {/* Tab 2: Dedicated CNC Programs & Files Grid */}
        {activeTab === 'files' && (
          <CncFilesView
            initialJobId={inspectedJobId || undefined}
          />
        )}

        {/* Tab 3: Work Orders (Lazy-loaded with server-side pagination) */}
        {activeTab === 'orders' && (
          <WorkOrdersTable
            onSelectWo={handleSelectWo}
          />
        )}

        {/* Tab 4: Piece Traceability (Lazy-loaded on demand) */}
        {activeTab === 'traceability' && (
          <TraceabilityView
            initialWo={traceabilityWo}
          />
        )}

        {/* Tab 5: Raw CNC File Inspector (Lazy-loaded with pagination) */}
        {activeTab === 'inspector' && (
          <CncFileInspector
            selectedJobId={inspectedJobId || undefined}
          />
        )}

        {/* Tab 6: Automated Verification Testbench */}
        {activeTab === 'tests' && (
          <VerificationTestBench />
        )}
      </main>

      {/* Sheet Timeline Modal */}
      <JobTimelineModal
        jobId={inspectedJobId}
        onClose={() => setInspectedJobId(null)}
      />

      {/* Industrial Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/80 py-4 text-center text-xs font-mono text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>CNC Production Monitoring &bull; PostgreSQL Event Engine &bull; Continuous Share Poller</span>
          <span>Background Service Active &bull; Canonical Unit: m²-mm</span>
        </div>
      </footer>
    </div>
  );
}
