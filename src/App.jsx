import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import StagingBanner from './components/StagingBanner';
import UnderwriterDashboard from './pages/UnderwriterDashboard';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

// No auth/admin gating here -- none of the pages in this app require a login
// (including UnderwriterDashboard, by explicit decision 2026-08-19 -- see its
// own file header), so the Base44-era loading/redirect/ProtectedRoute
// machinery was dead weight (always resolved to "just render the page" for
// every route, while still firing a doomed auth check against a Base44
// backend this app no longer has).
const AppRoutes = () => (
  <Routes>
    <Route path="/" element={
      <LayoutWrapper currentPageName={mainPageKey}>
        <MainPage />
      </LayoutWrapper>
    } />
    {Object.entries(Pages).map(([path, Page]) => (
      <Route
        key={path}
        path={`/${path}`}
        element={
          <LayoutWrapper currentPageName={path}>
            <Page />
          </LayoutWrapper>
        }
      />
    ))}
    {/* Rendered WITHOUT LayoutWrapper: UnderwriterDashboard builds its own
        full "min-h-screen" dark admin UI with its own header -- wrapping it
        in this app's public marketing Layout (nav bar, footer, floating chat
        widget) would double up chrome rather than compose with it. It's
        still reachable from the same nav bar as the other two pages, just
        via a manually-added navItems entry in Layout.jsx rather than the
        generic Pages-map loop above. */}
    <Route path="/UnderwriterDashboard" element={<UnderwriterDashboard />} />
    <Route path="*" element={<PageNotFound />} />
  </Routes>
);

function App() {
  return (
    <QueryClientProvider client={queryClientInstance}>
      <Router>
        <StagingBanner />
        <AppRoutes />
      </Router>
      <Toaster />
    </QueryClientProvider>
  )
}

export default App
