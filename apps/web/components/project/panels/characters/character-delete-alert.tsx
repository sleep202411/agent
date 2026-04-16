import { IconLoader2 } from "@tabler/icons-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function DeleteCharacterAlert(props: {
  open: boolean;
  name?: string;
  deleting: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
  tDelete: string;
  tCancel: string;
  tUnnamed: string;
}) {
  const label =
    "\u5220\u9664\u540E\u4E0D\u53EF\u6062\u590D\uFF0C\u786E\u8BA4\u5220\u9664 " +
    (props.name || props.tUnnamed) +
    " \u5417\uFF1F";
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.tDelete}</AlertDialogTitle>
          <AlertDialogDescription>{label}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{props.tCancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="soft"
            color="destructive"
            onClick={props.onDelete}
            disabled={props.deleting}
          >
            {props.deleting ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {props.tDelete}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
