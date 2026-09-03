import React from 'react';
import { Activity, Database, HardDrive, RefreshCw, Layers, FileCode, CheckCircle2, AlertTriangle } from 'lucide-react';
import { CncStatus, OrderSyncStatus } from '../types';

interface NavbarProps {
  cncStatus: CncStatus | null;
  orderSync: OrderSyncStatus | null;
  activeTab: 'production' | 'orders' | 'traceability' | 'inspector' | 'tests';
  setActiveTab: (tab: 'production' | 'orders' | 'traceability' | 'inspector' | 'tests') => void;
  lastUpdated: Date;
  isPolling: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  cncStatus,
  orderSync,
  activeTab,
  setActiveTab,
  lastUpdated,
  isPolling,
}) => {
  const isOnline = cncStatus?.isOnline ?? false;

  return (
    <header className="border-b border-slate-800 bg-slate-950/90 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Identity */}
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 font-bold">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-slate-100 text-base tracking-tight">CNC PRODUCTION MONITOR</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                  ISO-192.168.11.211
                </span>
              </div>
              <p className="text-xs text-slate-400">Continuous Industrial File Engine &amp; Event Stream</p>
            </div>
          </div>

          {/* Real-time Status Badges */}
          <div className="hidden md:flex items-center space-x-4">
            {/* CNC Machine Status */}
            <div
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-full border text-xs font-mono transition-colors ${
                isOnline
                  ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-800/80 text-rose-300'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
              <HardDrive className="w-3.5 h-3.5" />
              <span>{isOnline ? 'CNC ONLINE' : 'CNC OFFLINE'}</span>
              <span className="text-slate-500">|</span>
              <span className="text-[11px] text-slate-400">
                {cncStatus?.totalJobsTracked || 0} jobs watched
              </span>
            </div>

            {/* Google Sheet Order Master Status */}
            <div className="flex items-center space-x-2 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-xs font-mono text-slate-300">
              <Database className="w-3.5 h-3.5 text-sky-400" />
              <span>ORDER MASTER</span>
              <span className="text-slate-600">•</span>
              <span className="text-emerald-400">{orderSync?.rows_processed || 0} Orders</span>
            </div>

            {/* Auto Background Polling Heartbeat */}
            <div className="flex items-center space-x-1.5 text-xs font-mono text-slate-400">
              <RefreshCw className={`w-3 h-3 text-indigo-400 ${isPolling ? 'animate-spin' : ''}`} />
              <span className="text-[11px]">3s background stream</span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex space-x-1 overflow-x-auto pb-2 sm:pb-0 scrollbar-none">
          <button
            onClick={() => setActiveTab('production')}
            className={`px-3.5 py-2 text-xs font-medium rounded-t-md transition-colors border-b-2 flex items-center space-x-2 whitespace-nowrap ${
              activeTab === 'production'
                ? 'border-indigo-500 text-indigo-300 bg-indigo-950/30'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Live Production</span>
          </button>

          <button
            onClick={() => setActiveTab('orders')}
            className={`px-3.5 py-2 text-xs font-medium rounded-t-md transition-colors border-b-2 flex items-center space-x-2 whitespace-nowrap ${
              activeTab === 'orders'
                ? 'border-indigo-500 text-indigo-300 bg-indigo-950/30'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Work Orders (Google Sheet)</span>
          </button>

          <button
            onClick={() => setActiveTab('traceability')}
            className={`px-3.5 py-2 text-xs font-medium rounded-t-md transition-colors border-b-2 flex items-center space-x-2 whitespace-nowrap ${
              activeTab === 'traceability'
                ? 'border-indigo-500 text-indigo-300 bg-indigo-950/30'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Piece Traceability</span>
          </button>

          <button
            onClick={() => setActiveTab('inspector')}
            className={`px-3.5 py-2 text-xs font-medium rounded-t-md transition-colors border-b-2 flex items-center space-x-2 whitespace-nowrap ${
              activeTab === 'inspector'
                ? 'border-indigo-500 text-indigo-300 bg-indigo-950/30'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>CNC File Inspector (.FBT, .OTD, .CNI, .z01)</span>
          </button>

          <button
            onClick={() => setActiveTab('tests')}
            className={`px-3.5 py-2 text-xs font-medium rounded-t-md transition-colors border-b-2 flex items-center space-x-2 whitespace-nowrap ${
              activeTab === 'tests'
                ? 'border-emerald-500 text-emerald-300 bg-emerald-950/30'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Verification Testbench (8 Tests)</span>
          </button>
        </div>
      </div>
    </header>
  );
};
