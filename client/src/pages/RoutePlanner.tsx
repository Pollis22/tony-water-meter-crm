import { useQuery, useMutation } from '@tanstack/react-query';
import { useState, useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';

function MapResizer() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const onResize = () => map.invalidateSize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [map]);
  return null;
}
import type { Account, Route as RouteRow } from '@shared/schema';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmtNum, tierColor, fmtDuration, fmtKm, scoreColor, TIERS } from '@/lib/format';
import { Map as MapIcon, Navigation, Save, Printer, ExternalLink, Trash2, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// Build colored Leaflet pin icons per tier (SVG data URL)
function pinIcon(color: string, label?: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">
    <path d="M14 0C6.27 0 0 6.27 0 14c0 9.5 14 26 14 26s14-16.5 14-26C28 6.27 21.73 0 14 0z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
    <circle cx="14" cy="14" r="6" fill="#fff"/>
    ${label ? `<text x="14" y="17" text-anchor="middle" font-size="9" font-weight="700" fill="${color}" font-family="Inter,Arial">${label}</text>` : ''}
  </svg>`;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [28, 40],
    iconAnchor: [14, 40],
    popupAnchor: [0, -36],
  });
}

const tierPin: Record<string, string> = {
  'Tier 1': '#1e40af',
  'Tier 2': '#2563eb',
  'Tier 3': '#60a5fa',
};

interface OptimizeResult {
  order: number[];
  distanceMeters: number;
  durationSec: number;
  geometry?: { type: 'LineString'; coordinates: [number, number][] };
}

export default function RoutePlanner() {
  const { toast } = useToast();
  const [mapReady, setMapReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMapReady(true), 80); return () => clearTimeout(t); }, []);
  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ['/api/accounts'] });
  const { data: savedRoutes = [] } = useQuery<RouteRow[]>({ queryKey: ['/api/routes'] });

  const [tierFilter, setTierFilter] = useState<string>('all');
  const [countyFilter, setCountyFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [roundTrip, setRoundTrip] = useState(true);
  const [startAddr, setStartAddr] = useState('');
  const [startCoord, setStartCoord] = useState<[number, number] | null>(null);
  const [routeName, setRouteName] = useState('');
  const [optimized, setOptimized] = useState<OptimizeResult | null>(null);

  const counties = useMemo(() => Array.from(new Set(accounts.map(a => a.county))).sort(), [accounts]);

  const visible = useMemo(() => accounts.filter(a => {
    if (a.lat == null || a.lng == null) return false;
    if (tierFilter !== 'all' && a.tier !== tierFilter) return false;
    if (countyFilter !== 'all' && a.county !== countyFilter) return false;
    if (search && !`${a.name} ${a.county}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [accounts, tierFilter, countyFilter, search]);

  const selectedAccounts = useMemo(() => selected.map(id => accounts.find(a => a.id === id)!).filter(Boolean), [selected, accounts]);
  const orderedAccounts = useMemo(() => {
    if (!optimized) return selectedAccounts;
    return optimized.order.map(i => selectedAccounts[i]).filter(Boolean);
  }, [optimized, selectedAccounts]);

  function toggle(id: number) {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
    setOptimized(null);
  }

  function selectAllVisible() {
    setSelected(Array.from(new Set([...selected, ...visible.map(a => a.id)])));
    setOptimized(null);
  }

  function clearSelection() { setSelected([]); setOptimized(null); }

  const optimizeMut = useMutation({
    mutationFn: async (): Promise<OptimizeResult> => {
      const coords: [number, number][] = selectedAccounts.map(a => [a.lng!, a.lat!]);
      const body: any = { coords, roundTrip };
      if (startCoord) body.fixedStart = startCoord;
      const r = await apiRequest('POST', '/api/optimize-route', body);
      return r.json();
    },
    onSuccess: (data) => { setOptimized(data); toast({ title: 'Route optimized', description: `${fmtKm(data.distanceMeters)} · ${fmtDuration(data.durationSec)}` }); },
    onError: (e: any) => toast({ title: 'Optimize failed', description: e.message, variant: 'destructive' }),
  });

  const saveMut = useMutation({
    mutationFn: async () => (await apiRequest('POST', '/api/routes', {
      name: routeName || `Route ${new Date().toLocaleString()}`,
      startLabel: startAddr || null,
      startLat: startCoord?.[1] ?? null,
      startLng: startCoord?.[0] ?? null,
      accountIds: JSON.stringify(selected),
      orderedIds: JSON.stringify(orderedAccounts.map(a => a.id)),
      totalDistanceKm: optimized ? optimized.distanceMeters / 1000 : null,
      totalDurationSec: optimized?.durationSec ?? null,
    })).json(),
    onSuccess: () => { setRouteName(''); queryClient.invalidateQueries({ queryKey: ['/api/routes'] }); toast({ title: 'Route saved' }); },
  });

  const delRouteMut = useMutation({
    mutationFn: async (id: number) => apiRequest('DELETE', `/api/routes/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/routes'] }),
  });

  function loadRoute(r: RouteRow) {
    try {
      const ids = JSON.parse(r.accountIds);
      setSelected(ids);
      setOptimized(null);
      if (r.startLat != null && r.startLng != null) setStartCoord([r.startLng, r.startLat]);
      if (r.startLabel) setStartAddr(r.startLabel);
      toast({ title: `Loaded "${r.name}"`, description: `${ids.length} stops` });
    } catch (e) {
      toast({ title: 'Load failed', variant: 'destructive' });
    }
  }

  function googleMapsUrl() {
    const stops = orderedAccounts.map(a => `${a.lat},${a.lng}`);
    if (startCoord) stops.unshift(`${startCoord[1]},${startCoord[0]}`);
    if (roundTrip && startCoord) stops.push(`${startCoord[1]},${startCoord[0]}`);
    const url = `https://www.google.com/maps/dir/${stops.join('/')}`;
    return url;
  }

  function geocodeStart() {
    if (!startAddr.trim()) return;
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(startAddr)}&limit=1`)
      .then(r => r.json()).then(arr => {
        if (arr[0]) {
          setStartCoord([parseFloat(arr[0].lon), parseFloat(arr[0].lat)]);
          toast({ title: 'Start location set', description: arr[0].display_name });
        } else toast({ title: 'Address not found', variant: 'destructive' });
      });
  }

  const polyline = optimized?.geometry?.coordinates?.map(([lng, lat]) => [lat, lng] as [number, number]) ?? [];

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Left panel */}
      <div className="w-[420px] shrink-0 border-r bg-white dark:bg-slate-900 flex flex-col no-print">
        <div className="p-4 border-b">
          <h1 className="text-xl font-semibold flex items-center gap-2"><MapIcon className="w-5 h-5 text-blue-600" /> Route Planner</h1>
          <p className="text-xs text-muted-foreground mt-1">Pick stops · optimize · export to Google Maps</p>
        </div>

        <div className="p-3 border-b space-y-2">
          <Input data-testid="input-start" placeholder="Start address (optional)" value={startAddr} onChange={e => setStartAddr(e.target.value)} onBlur={geocodeStart} />
          <div className="flex items-center gap-2 text-sm">
            <Checkbox id="rt" checked={roundTrip} onCheckedChange={(v) => { setRoundTrip(!!v); setOptimized(null); }} data-testid="checkbox-roundtrip" />
            <label htmlFor="rt" className="cursor-pointer">Round trip (return to start)</label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" onClick={() => optimizeMut.mutate()} disabled={selected.length < 2 || optimizeMut.isPending} data-testid="button-optimize">
              <Sparkles className="w-3 h-3 mr-1" /> {optimizeMut.isPending ? 'Optimizing...' : 'Optimize Route'}
            </Button>
            <Button size="sm" variant="outline" onClick={clearSelection} disabled={selected.length === 0} data-testid="button-clear">Clear ({selected.length})</Button>
          </div>
        </div>

        {optimized && (
          <div className="p-3 border-b bg-blue-50 dark:bg-blue-950/30">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><div className="text-xs text-muted-foreground">Distance</div><div className="font-semibold">{fmtKm(optimized.distanceMeters)}</div></div>
              <div><div className="text-xs text-muted-foreground">Drive Time</div><div className="font-semibold">{fmtDuration(optimized.durationSec)}</div></div>
            </div>
            <div className="grid grid-cols-3 gap-1 mt-3">
              <Input className="col-span-3" placeholder="Route name" value={routeName} onChange={e => setRouteName(e.target.value)} data-testid="input-route-name" />
              <Button size="sm" onClick={() => saveMut.mutate()} data-testid="button-save-route"><Save className="w-3 h-3 mr-1" /> Save</Button>
              <a href={googleMapsUrl()} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline" className="w-full" data-testid="button-google-maps"><ExternalLink className="w-3 h-3 mr-1" /> Google</Button>
              </a>
              <Button size="sm" variant="outline" onClick={() => window.print()} data-testid="button-print"><Printer className="w-3 h-3 mr-1" /> Print</Button>
            </div>
          </div>
        )}

        <div className="p-3 border-b space-y-2">
          <Input placeholder="Search accounts..." value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-accounts" />
          <div className="grid grid-cols-2 gap-2">
            <Select value={tierFilter} onValueChange={setTierFilter}>
              <SelectTrigger data-testid="select-tier-filter"><SelectValue placeholder="Tier" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tiers</SelectItem>
                {TIERS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={countyFilter} onValueChange={setCountyFilter}>
              <SelectTrigger data-testid="select-county-filter"><SelectValue placeholder="County" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Counties</SelectItem>
                {counties.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" variant="outline" className="w-full" onClick={selectAllVisible} data-testid="button-select-visible">Select All Visible ({visible.length})</Button>
        </div>

        <div className="flex-1 overflow-auto">
          {(optimized ? orderedAccounts : visible).map((a, idx) => a && (
            <div key={a.id} className={`flex items-start gap-2 px-3 py-2 border-b text-sm ${selected.includes(a.id) ? 'bg-blue-50 dark:bg-blue-950/20' : ''}`} data-testid={`route-account-${a.id}`}>
              <Checkbox checked={selected.includes(a.id)} onCheckedChange={() => toggle(a.id)} className="mt-0.5" />
              {optimized && selected.includes(a.id) && (
                <div className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center mt-0.5">{idx + 1}</div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{a.name}</div>
                <div className="text-xs text-muted-foreground">{a.county} · {fmtNum(a.endpoints)} endpoints</div>
              </div>
              <Badge className={tierColor[a.tier] + ' text-[10px]'}>{a.tier.replace('Tier ', 'T')}</Badge>
            </div>
          ))}
        </div>

        {savedRoutes.length > 0 && (
          <div className="border-t p-3 max-h-64 overflow-auto">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Saved Routes</div>
            <div className="space-y-1">
              {savedRoutes.map(r => (
                <div key={r.id} className="flex items-center justify-between text-xs p-2 hover:bg-accent rounded">
                  <button onClick={() => loadRoute(r)} className="flex-1 text-left" data-testid={`saved-route-${r.id}`}>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-muted-foreground">
                      {(() => { try { return JSON.parse(r.accountIds).length; } catch { return 0; } })()} stops
                      {r.totalDistanceKm && ` · ${(r.totalDistanceKm * 0.621371).toFixed(1)} mi`}
                    </div>
                  </button>
                  <Button size="sm" variant="ghost" onClick={() => delRouteMut.mutate(r.id)} data-testid={`button-delete-route-${r.id}`}><Trash2 className="w-3 h-3" /></Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        {mapReady && (
        <MapContainer center={[42.5, -84.0]} zoom={8} style={{ height: '100%', width: '100%' }}>
          <MapResizer />
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {visible.map(a => {
            const isSelected = selected.includes(a.id);
            const orderIdx = optimized ? optimized.order.findIndex(i => selectedAccounts[i]?.id === a.id) : -1;
            const label = orderIdx >= 0 ? String(orderIdx + 1) : undefined;
            const color = isSelected ? '#dc2626' : tierPin[a.tier] || '#64748b';
            return (
              <Marker key={a.id} position={[a.lat!, a.lng!]} icon={pinIcon(color, label)}>
                <Popup>
                  <div style={{ minWidth: 200 }}>
                    <div style={{ fontWeight: 600 }}>{a.name}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{a.tier} · {a.county} County</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>Endpoints: {fmtNum(a.endpoints)}</div>
                    <div style={{ fontSize: 12 }}>Score: <strong>{a.candidateScore}</strong></div>
                    <Button size="sm" className="mt-2 w-full" onClick={() => toggle(a.id)}>
                      {isSelected ? 'Remove from route' : 'Add to route'}
                    </Button>
                  </div>
                </Popup>
              </Marker>
            );
          })}
          {startCoord && (
            <Marker position={[startCoord[1], startCoord[0]]} icon={pinIcon('#16a34a', 'S')}>
              <Popup>Start: {startAddr}</Popup>
            </Marker>
          )}
          {polyline.length > 1 && <Polyline positions={polyline} color="#2563eb" weight={4} opacity={0.7} />}
        </MapContainer>)}

        {/* Print itinerary (only visible when printing) */}
        <div className="print-only p-6">
          <h1 className="text-xl font-semibold mb-2">Route Itinerary</h1>
          {optimized && <div className="text-sm mb-4">Total: {fmtKm(optimized.distanceMeters)} · {fmtDuration(optimized.durationSec)}</div>}
          <ol className="space-y-3">
            {orderedAccounts.map((a, i) => a && (
              <li key={a.id} className="border-b pb-2">
                <div className="font-semibold">{i + 1}. {a.name} <span className="text-sm font-normal text-muted-foreground">({a.tier})</span></div>
                <div className="text-sm">{a.address || ''} {a.cityState || ''}</div>
                <div className="text-sm">Contact: {a.primaryContact || 'Unknown'} {a.phone ? ` · ${a.phone}` : ''}</div>
                <div className="text-sm">Endpoints: {fmtNum(a.endpoints)} · Score: {a.candidateScore}</div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
