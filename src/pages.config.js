/**
 * pages.config.js - Page routing configuration
 *
 * STRIPPED VERSION: this app has been reduced to only the two Quick Check
 * flows (see repo strip commit). mainPage is set to QuickDocCheck since it's
 * the more general-purpose of the two entry points; RefinanceQuickCheck is
 * still reachable at /RefinanceQuickCheck.
 */
import QuickDocCheck from './pages/QuickDocCheck';
import RefinanceQuickCheck from './pages/RefinanceQuickCheck';
import __Layout from './Layout.jsx';


export const PAGES = {
    "QuickDocCheck": QuickDocCheck,
    "RefinanceQuickCheck": RefinanceQuickCheck,
}

export const pagesConfig = {
    mainPage: "QuickDocCheck",
    Pages: PAGES,
    Layout: __Layout,
};
