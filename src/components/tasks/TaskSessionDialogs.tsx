import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/Button";
import { taskPauseStore } from "@/stores/taskPauseStore";

export function TaskSessionDialogs() {
  const navigate = useNavigate();
  const exitOpen = taskPauseStore((s) => s.exitDialogOpen);
  const closeExit = taskPauseStore((s) => s.closeExitConfirm);
  const resumeSession = taskPauseStore((s) => s.resumeSession);

  return (
    <Dialog
      open={exitOpen}
      onOpenChange={(open) => {
        if (open) {
          taskPauseStore.getState().pauseSession();
          return;
        }
        closeExit();
        resumeSession();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Leave this test?</DialogTitle>
          <DialogDescription>
            The test is paused. Are you sure you want to go to the dashboard? Choose Resume test to
            continue where you left off.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button type="button" variant="primary" className="w-full" onClick={() => resumeSession()}>
            Resume test
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => {
              taskPauseStore.getState().unregisterSession();
              closeExit();
              navigate("/user");
            }}
          >
            Yes, go to dashboard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
