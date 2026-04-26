import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/AppLayout";
import Dashboard from "@/pages/Dashboard";
import Accounts from "@/pages/Accounts";
import AccountDetail from "@/pages/AccountDetail";
import RoutePlanner from "@/pages/RoutePlanner";
import Tasks from "@/pages/Tasks";
import Notes from "@/pages/Notes";
import Contacts from "@/pages/Contacts";
import Opportunities from "@/pages/Opportunities";
import Reports from "@/pages/Reports";
import Settings from "@/pages/Settings";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/accounts" component={Accounts} />
      <Route path="/accounts/:id" component={AccountDetail} />
      <Route path="/contacts" component={Contacts} />
      <Route path="/opportunities" component={Opportunities} />
      <Route path="/route-planner" component={RoutePlanner} />
      <Route path="/tasks" component={Tasks} />
      <Route path="/notes" component={Notes} />
      <Route path="/reports" component={Reports} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <AppLayout>
            <AppRouter />
          </AppLayout>
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
