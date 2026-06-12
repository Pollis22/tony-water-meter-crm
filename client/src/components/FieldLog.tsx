import { ReactNode, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { Account } from '@shared/schema';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { addDaysStr, todayStr } from '@/lib/field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Mic, MicOff, PhoneCall, Save } from 'lucide-react';

// ---------------------------------------------------------------------------
// Voice dictation (Web Speech API). Appends final transcripts via onText.
// Gracefully absent on browsers without SpeechRecognition (some iOS versions).
// ---------------------------------------------------------------------------
function useDictation(onText: (t: string) => void) {
  const recRef = useRef<any>(null);
  const [listening, setListening] = useState(false);
  const SR: any =
    typeof window !== 'undefined'
      ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : null;
  const supported = !!SR;

  const stop = () => {
    try { recRef.current?.stop(); } catch { /* already stopped */ }
    setListening(false);
  };
  const start = () => {
    if (!SR || listening) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-US';
    rec.onresult = (e: any) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) text += e.results[i][0].transcript;
      }
      if (text.trim()) onText(text.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };
  return { supported, listening, start, stop };
}

function MicButton({ onText, className = '' }: { onText: (t: string) => void; className?: string }) {
  const { supported, listening, start, stop } = useDictation(onText);
  if (!supported) return null;
  return (
    <Button
      type="button"
      size="icon"
      variant={listening ? 'destructive' : 'outline'}
      className={`${listening ? 'animate-pulse' : ''} ${className}`}
      onClick={listening ? stop : start}
      title={listening ? 'Stop dictation' : 'Dictate'}
      data-testid="button-mic"
    >
      {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Quick log: outcome chip + optional note + next follow-up, in two taps.
// ---------------------------------------------------------------------------
const OUTCOMES: { key: string; label: string; type: 'call' | 'email' | 'meeting' | 'visit'; outcome: string }[] = [
  { key: 'spoke', label: 'Spoke', type: 'call', outcome: 'Call — spoke' },
  { key: 'no_answer', label: 'No answer', type: 'call', outcome: 'Call — no answer' },
  { key: 'voicemail', label: 'Voicemail', type: 'call', outcome: 'Call — left voicemail' },
  { key: 'email', label: 'Email sent', type: 'email', outcome: 'Email sent' },
  { key: 'visit', label: 'Site visit', type: 'visit', outcome: 'Site visit' },
  { key: 'meeting', label: 'Meeting', type: 'meeting', outcome: 'Meeting held' },
];

const FOLLOWUPS: { key: string; label: string }[] = [
  { key: '1', label: 'Tomorrow' },
  { key: '3', label: '+3 days' },
  { key: '7', label: '+1 week' },
  { key: '14', label: '+2 weeks' },
  { key: 'custom', label: 'Pick date' },
  { key: 'nochange', label: 'No change' },
];

export function QuickLogDialog({
  account,
  trigger,
  onLogged,
}: {
  account: Pick<Account, 'id' | 'name'>;
  trigger?: ReactNode;
  onLogged?: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [outcomeKey, setOutcomeKey] = useState('spoke');
  const [note, setNote] = useState('');
  const [fu, setFu] = useState('7');
  const [customDate, setCustomDate] = useState('');

  const reset = () => { setOutcomeKey('spoke'); setNote(''); setFu('7'); setCustomDate(''); };

  const mut = useMutation({
    mutationFn: async () => {
      const o = OUTCOMES.find((x) => x.key === outcomeKey)!;
      const body: Record<string, unknown> = { type: o.type, outcome: o.outcome, note: note.trim() || undefined };
      if (fu === 'custom') { if (customDate) body.nextFollowUpAt = customDate; }
      else if (fu !== 'nochange') body.nextFollowUpAt = addDaysStr(todayStr(), Number(fu));
      return (await apiRequest('POST', `/api/accounts/${account.id}/log`, body)).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/activities', account.id] });
      toast({ title: `Logged — ${account.name}` });
      setOpen(false);
      reset();
      onLogged?.();
    },
    onError: () => toast({ title: 'Could not save the log entry', variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" data-testid={`button-quicklog-${account.id}`}>
            <PhoneCall className="w-4 h-4 mr-1" /> Log
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log a touch — {account.name}</DialogTitle>
          <DialogDescription>Outcome, optional note, next follow-up. Done in seconds.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2">
          {OUTCOMES.map((o) => (
            <Button
              key={o.key}
              type="button"
              variant={outcomeKey === o.key ? 'default' : 'outline'}
              className="h-11"
              onClick={() => setOutcomeKey(o.key)}
              data-testid={`chip-outcome-${o.key}`}
            >
              {o.label}
            </Button>
          ))}
        </div>

        <div className="flex items-start gap-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note — what happened, what's next…"
            rows={3}
            className="flex-1"
            data-testid="input-quicklog-note"
          />
          <MicButton onText={(t) => setNote((p) => (p ? `${p} ${t}` : t))} className="h-11 w-11 shrink-0" />
        </div>

        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1.5">Next follow-up</div>
          <div className="grid grid-cols-3 gap-2">
            {FOLLOWUPS.map((f) => (
              <Button
                key={f.key}
                type="button"
                size="sm"
                variant={fu === f.key ? 'secondary' : 'outline'}
                className="h-9"
                onClick={() => setFu(f.key)}
                data-testid={`chip-fu-${f.key}`}
              >
                {f.label}
              </Button>
            ))}
          </div>
          {fu === 'custom' && (
            <Input
              type="date"
              className="mt-2"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              data-testid="input-fu-date"
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="h-10" disabled={mut.isPending} onClick={() => mut.mutate()} data-testid="button-quicklog-save">
            {mut.isPending ? 'Saving…' : 'Save log'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Voice note: dictate (or type) straight onto the account timeline.
// Type "note" deliberately doesn't bump lastContactedAt.
// ---------------------------------------------------------------------------
export function VoiceNoteCard({ accountId }: { accountId: number }) {
  const { toast } = useToast();
  const [text, setText] = useState('');
  const dictation = useDictation((t) => setText((p) => (p ? `${p} ${t}` : t)));

  const mut = useMutation({
    mutationFn: async () =>
      (await apiRequest('POST', `/api/accounts/${accountId}/log`, {
        type: 'note',
        outcome: 'Voice note',
        note: text.trim(),
      })).json(),
    onSuccess: () => {
      setText('');
      queryClient.invalidateQueries({ queryKey: ['/api/activities', accountId] });
      toast({ title: 'Note saved to timeline' });
    },
    onError: () => toast({ title: 'Could not save note', variant: 'destructive' }),
  });

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Mic className="w-4 h-4 text-blue-600" /> Voice note
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-start gap-2">
          {dictation.supported ? (
            <Button
              type="button"
              size="icon"
              variant={dictation.listening ? 'destructive' : 'default'}
              className={`h-12 w-12 rounded-full shrink-0 ${dictation.listening ? 'animate-pulse' : ''}`}
              onClick={dictation.listening ? dictation.stop : dictation.start}
              data-testid="button-voice-note-mic"
            >
              {dictation.listening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </Button>
          ) : null}
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder={
              dictation.supported
                ? 'Tap the mic in the truck — "met with the DPW director, wants AMI pilot pricing by Friday…"'
                : 'Voice input isn’t supported in this browser — type your note here.'
            }
            className="flex-1"
            data-testid="input-voice-note"
          />
        </div>
        <div className="flex justify-end gap-2">
          {text && (
            <Button variant="ghost" size="sm" onClick={() => setText('')}>Clear</Button>
          )}
          <Button size="sm" disabled={!text.trim() || mut.isPending} onClick={() => mut.mutate()} data-testid="button-voice-note-save">
            <Save className="w-4 h-4 mr-1" /> {mut.isPending ? 'Saving…' : 'Save to timeline'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
