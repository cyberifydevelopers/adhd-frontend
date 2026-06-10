import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { SidebarLayout } from "@/components/sidebar/SidebarLayout";
import Login from "@/pages/Auth/Login";
import ForgotPassword from "@/pages/Auth/ForgotPassword";
import AdminDashboard from "@/pages/Admin/Dashboard";
import AdminUsers from "@/pages/Admin/Users";
import AdminAuditLogs from "@/pages/Admin/AuditLogs";
import AdminSessionDetail from "@/pages/Admin/SessionDetail";
import AdminUserDetail from "@/pages/Admin/UserDetail";
import AdminBatteryQc from "@/pages/Admin/BatteryQc";
import AdminFormulary from "@/pages/Admin/Formulary";
import AdminVersionControl from "@/pages/Admin/VersionControl";
import AdminCATConfig from "@/pages/Admin/CATConfig";
import ProfilePage from "@/pages/Profile";
import SettingsPage from "@/pages/Settings";
import UserDashboard from "@/pages/User/Dashboard";
import UserReport from "@/pages/User/Report";
import UserMedication from "@/pages/User/Medication";
import UserIntake from "@/pages/User/Intake";
import UserChangePassword from "@/pages/User/ChangePassword";
import ContinuousPerformanceTest from "@/components/tasks/cpt";
import StopSignalTask from "@/components/tasks/sst";
import DigitSpanTask from "@/components/tasks/digit-span";
import TimeEstimationTask from "@/components/tasks/time-estimation";
import SimpleReactionTimeTask from "@/components/tasks/simple-rt";
import ChoiceReactionTimeTask from "@/components/tasks/choice-rt";
import FlankerTask from "@/components/tasks/flanker";
import TaskSwitchingTask from "@/components/tasks/task-switching";
import DelayDiscountingTask from "@/components/tasks/delay-discounting";
import SubstanceRouter from "@/components/tasks/substance-router";
import SubstanceDDTask from "@/components/tasks/substance-dd";
import PsychomotorSpeedTask from "@/components/tasks/psychomotor-speed";
import SetShiftingMiniTask from "@/components/tasks/set-shifting-mini";
import WMDistractionTask from "@/components/tasks/wm-distraction";

const STAFF_ROLES = ["admin", "superadmin", "clinician"];

function ProtectedAdmin() {
  const me = useAuthStore((s) => s.me);
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  if (!me) return <div className="flex min-h-screen items-center justify-center"><div className="animate-pulse text-muted-foreground">Loading…</div></div>;
  if (!STAFF_ROLES.includes(me.role)) return <Navigate to="/user" replace />;
  return (
    <SidebarLayout>
      <Outlet />
    </SidebarLayout>
  );
}

function ProtectedUser() {
  const me = useAuthStore((s) => s.me);
  const token = useAuthStore((s) => s.token);
  const location = useLocation();
  const path = location.pathname;

  if (!token) return <Navigate to="/login" replace />;
  if (!me) return <div className="flex min-h-screen items-center justify-center"><div className="animate-pulse text-muted-foreground">Loading…</div></div>;
  if (me.role !== "user") return <Navigate to="/admin" replace />;

  if (me.password_change_required && !path.includes("/user/change-password")) {
    return <Navigate to="/user/change-password" replace />;
  }
  if (!me.password_change_required && !me.has_intake && !path.includes("/user/intake") && !path.includes("/user/change-password")) {
    return <Navigate to="/user/intake" replace />;
  }
  return <Outlet />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/admin" element={<ProtectedAdmin />}>
        <Route index element={<AdminDashboard />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="users/:userId" element={<AdminUserDetail />} />
        <Route path="users/:userId/batteries/:batteryId/qc" element={<AdminBatteryQc />} />
        <Route path="audit-logs" element={<AdminAuditLogs />} />
        <Route path="formulary" element={<AdminFormulary />} />
        <Route path="version-control" element={<AdminVersionControl />} />
        <Route path="cat-config" element={<AdminCATConfig />} />
        <Route path="sessions/:sessionId" element={<AdminSessionDetail />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="/user" element={<ProtectedUser />}>
        <Route index element={<UserDashboard />} />
        <Route path="intake" element={<UserIntake />} />
        <Route path="change-password" element={<UserChangePassword />} />
        <Route path="results" element={<UserReport />} />
        <Route path="medication" element={<UserMedication />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="tasks/cpt" element={<ContinuousPerformanceTest />} />
        <Route path="tasks/sst" element={<StopSignalTask />} />
        <Route path="tasks/digit-span" element={<DigitSpanTask />} />
        <Route path="tasks/time-estimation" element={<TimeEstimationTask />} />
        <Route path="tasks/simple-rt" element={<SimpleReactionTimeTask />} />
        <Route path="tasks/choice-rt" element={<ChoiceReactionTimeTask />} />
        <Route path="tasks/flanker" element={<FlankerTask />} />
        <Route path="tasks/task-switching" element={<TaskSwitchingTask />} />
        <Route path="tasks/delay-discounting" element={<DelayDiscountingTask />} />
        <Route path="tasks/substance-modules" element={<SubstanceRouter />} />
        <Route path="tasks/substance-dd" element={<SubstanceDDTask />} />
        <Route path="tasks/psychomotor-speed" element={<PsychomotorSpeedTask />} />
        <Route path="tasks/set-shifting-mini" element={<SetShiftingMiniTask />} />
        <Route path="tasks/wm-distraction" element={<WMDistractionTask />} />
      </Route>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
