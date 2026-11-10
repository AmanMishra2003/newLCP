import LeetCodeDashboard from "./LeetCodeDashboard.jsx";
import "./App.css";
import { useState } from "react";

export default function App() {
  const [page, setPage] = useState("classmates");

  return <LeetCodeDashboard page={page} onPageChange={setPage} />;
}
