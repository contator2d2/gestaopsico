import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  Users, Search, Filter, Plus, Tag, Calendar, 
  CheckCircle2, XCircle, MoreHorizontal, Send,
  UserPlus, Hash, MessageCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription 
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { pacientesApi, whatsappApi, eventsApi } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

export default function CRM() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false);
  const [isEventDialogOpen, setIsEventDialogOpen] = useState(false);
  const [targetGroupId, setTargetGroupId] = useState("");
  const [targetEventId, setTargetEventId] = useState("");

  const { data: patientsData, isLoading: isLoadingPatients } = useQuery({
    queryKey: ["patients", search],
    queryFn: () => pacientesApi.list({ search }),
  });

  const { data: groups, isLoading: isLoadingGroups } = useQuery({
    queryKey: ["whatsapp-groups"],
    queryFn: () => whatsappApi.getGroups(),
    enabled: isGroupDialogOpen,
  });

  const { data: events, isLoading: isLoadingEvents } = useQuery({
    queryKey: ["events"],
    queryFn: () => eventsApi.list(),
    enabled: isEventDialogOpen,
  });

  const addToGroupMutation = useMutation({
    mutationFn: () => {
      const phones = patients.filter(p => selectedContacts.includes(p.id)).map(p => p.phone);
      return whatsappApi.addGroupParticipants(targetGroupId, phones);
    },
    onSuccess: () => {
      toast({ title: "Sucesso", description: "Contatos adicionados ao grupo com sucesso!" });
      setIsGroupDialogOpen(false);
      setSelectedContacts([]);
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const registerEventMutation = useMutation({
    mutationFn: async () => {
      for (const contactId of selectedContacts) {
        await eventsApi.addParticipation(targetEventId, contactId);
      }
    },
    onSuccess: () => {
      toast({ title: "Sucesso", description: "Presença registrada nos eventos!" });
      setIsEventDialogOpen(false);
      setSelectedContacts([]);
      qc.invalidateQueries({ queryKey: ["patients"] });
    },
  });

  const patients = Array.isArray(patientsData) ? patientsData : (patientsData as any)?.data || [];

  const toggleSelect = (id: string) => {
    setSelectedContacts(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedContacts.length === patients.length) {
      setSelectedContacts([]);
    } else {
      setSelectedContacts(patients.map((p: any) => p.id));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">CRM & Leads</h1>
          <p className="text-muted-foreground mt-1">Gerencie seus leads e participação em eventos</p>
        </div>
        <div className="flex gap-2">
          {selectedContacts.length > 0 && (
            <>
              <Button variant="outline" onClick={() => setIsGroupDialogOpen(true)}>
                <MessageCircle className="w-4 h-4 mr-2" /> Incluir em Grupo
              </Button>
              <Button variant="outline" onClick={() => setIsEventDialogOpen(true)}>
                <Calendar className="w-4 h-4 mr-2" /> Registrar em Evento
              </Button>
            </>
          )}
          <Button>
            <Plus className="w-4 h-4 mr-2" /> Novo Lead
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Buscar por nome, tag ou telefone..." 
            className="pl-10" 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
          />
        </div>
        <Button variant="outline" size="icon"><Filter className="w-4 h-4" /></Button>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-5 py-3 text-left w-10">
                <Checkbox 
                  checked={selectedContacts.length > 0 && selectedContacts.length === patients.length}
                  onCheckedChange={toggleSelectAll}
                />
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-3">Contato</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-3">Tags</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-3">Histórico</th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-3">Status</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoadingPatients ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={6} className="px-5 py-4"><Skeleton className="h-8 w-full" /></td></tr>
              ))
            ) : patients.map((p: any) => (
              <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-5 py-3">
                  <Checkbox 
                    checked={selectedContacts.includes(p.id)}
                    onCheckedChange={() => toggleSelect(p.id)}
                  />
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold">{p.name[0]}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.phone}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <div className="flex flex-wrap gap-1">
                    {p.is_mentorado && <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">Mentorado</Badge>}
                    {p.tags?.map((tag: string) => (
                      <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                    ))}
                    <Button variant="ghost" size="icon" className="h-6 w-6"><Plus className="w-3 h-3" /></Button>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Calendar className="w-3 h-3" />
                    <span>{p.eventParticipations?.length || 0} eventos</span>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <Badge variant={p.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">
                    {p.status === 'active' ? 'Ativo' : 'Lead'}
                  </Badge>
                </td>
                <td className="px-5 py-3 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon"><MoreHorizontal className="w-4 h-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>Ver Detalhes</DropdownMenuItem>
                      <DropdownMenuItem>Editar Tags</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive">Remover</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Dialog for WhatsApp Groups */}
      <Dialog open={isGroupDialogOpen} onOpenChange={setIsGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Incluir em Grupo do WhatsApp</DialogTitle>
            <DialogDescription>
              Selecione o grupo para adicionar os {selectedContacts.length} contatos selecionados.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {isLoadingGroups ? <Skeleton className="h-10 w-full" /> : (
              <div className="grid gap-2">
                {groups?.map((group: any) => (
                  <div 
                    key={group.id} 
                    className={`p-3 border rounded-lg cursor-pointer hover:bg-muted transition-colors ${targetGroupId === group.id ? 'border-primary bg-primary/5' : 'border-border'}`}
                    onClick={() => setTargetGroupId(group.id)}
                  >
                    <p className="font-medium text-sm">{group.name || group.subject}</p>
                    <p className="text-xs text-muted-foreground">{group.participants?.length || 0} participantes</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsGroupDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => addToGroupMutation.mutate()} disabled={!targetGroupId || addToGroupMutation.isPending}>
              {addToGroupMutation.isPending ? "Adicionando..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog for Events */}
      <Dialog open={isEventDialogOpen} onOpenChange={setIsEventDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar em Evento</DialogTitle>
            <DialogDescription>
              Vincule os {selectedContacts.length} contatos a um evento existente.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {isLoadingEvents ? <Skeleton className="h-10 w-full" /> : (
              <div className="grid gap-2">
                {events?.map((event: any) => (
                  <div 
                    key={event.id} 
                    className={`p-3 border rounded-lg cursor-pointer hover:bg-muted transition-colors ${targetEventId === event.id ? 'border-primary bg-primary/5' : 'border-border'}`}
                    onClick={() => setTargetEventId(event.id)}
                  >
                    <p className="font-medium text-sm">{event.title}</p>
                    <p className="text-xs text-muted-foreground">{new Date(event.date).toLocaleDateString()} - {event.type}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEventDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => registerEventMutation.mutate()} disabled={!targetEventId || registerEventMutation.isPending}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
