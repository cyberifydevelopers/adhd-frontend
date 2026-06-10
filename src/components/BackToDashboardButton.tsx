import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/Button";

type Props = {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg";
};

/** Navigate to user dashboard and refetch assignments so status is up to date. */
export function BackToDashboardButton({ variant = "outline", size = "md" }: Props) {
  const navigate = useNavigate();
  const fetchMe = useAuthStore((s) => s.fetchMe);

  const handleClick = async () => {
    await fetchMe();
    navigate("/user");
  };

  return (
    <Button onClick={handleClick} variant={variant} size={size}>
      Back to dashboard
    </Button>
  );
}
