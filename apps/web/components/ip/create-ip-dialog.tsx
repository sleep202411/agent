import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

const MOCK_CATEGORIES = [
  { value: "1", label: "AIGC影视" },
  { value: "2", label: "热血动漫" },
  { value: "3", label: "AI纪录片" },
  { value: "4", label: "文化传统" },
  { value: "5", label: "经典动画" },
  { value: "6", label: "AI经典改编" },
  { value: "7", label: "末日来临" },
  { value: "8", label: "爱情故事" },
  { value: "9", label: "AI科幻" },
];

interface CreateIPDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateIPDialog({ open, onOpenChange }: CreateIPDialogProps) {
  const t = useTranslations("ipCreate");
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [typeId, setTypeId] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = () => {
    if (!name.trim() || !typeId || creating) return;
    setCreating(true);
    // TODO: POST /project/create
    const mockId = `mock_${Date.now()}`;
    setTimeout(() => {
      setCreating(false);
      onOpenChange(false);
      setName("");
      setTypeId("");
      setDescription("");
      toast.success(t("createSuccess"));
      void navigate({ to: "/ips/$id/edit", params: { id: mockId } });
    }, 500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("pageTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 p-4">
          <div className="space-y-2">
            <Label>
              {t("fieldName")} <span className="text-destructive">*</span>
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("fieldNamePlaceholder")}
              maxLength={20}
            />
          </div>
          <div className="space-y-2">
            <Label>
              {t("fieldCategory")} <span className="text-destructive">*</span>
            </Label>
            <Select value={typeId} onValueChange={setTypeId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("fieldCategoryPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {MOCK_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("fieldDescription")}</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("fieldDescriptionPlaceholder")}
              maxLength={500}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || !typeId || creating}
            className="w-full"
          >
            {creating ? t("creating") : t("saveAndContinue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
