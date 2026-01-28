import { useState, useEffect, useMemo, useCallback } from "react";
import {
  List,
  ActionPanel,
  Action,
  showToast,
  Toast,
  Icon,
  Color,
  LocalStorage,
  useNavigation,
  Form,
} from "@raycast/api";
import {
  checkGcloudInstalled,
  getGCPProjects,
  searchIPInProject,
  generateResourceURL,
  getResourceIcon,
  getResourceTypeName,
  SearchResult,
  GcloudStatusType,
  checkGcloudStatus,
} from "./utils";

type SearchMode = "quick" | "full" | "custom";

interface HistoryItem {
  ip: string;
  results: SearchResult[];
  timestamp: number;
  projectCount: number;
  mode?: SearchMode;
}

// IP validation helper function
function isValidIP(ip: string): boolean {
  // IPv4 regex
  const ipv4Regex =
    /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

  // IPv6 regex (simplified - covers most common cases)
  const ipv6Regex =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;

  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}

function SearchCommand() {
  const [searchText, setSearchText] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("quick");
  const [customProjects, setCustomProjects] = useState<string>("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [gcloudStatus, setGcloudStatus] = useState<GcloudStatusType>({
    type: "loading",
    message: "Checking gcloud...",
  });
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const { push } = useNavigation();

  // Load history on mount
  useEffect(() => {
    (async () => {
      const storedHistory =
        await LocalStorage.getItem<string>("search-history");
      if (storedHistory) {
        try {
          const parsed = JSON.parse(storedHistory);
          setHistory(parsed);
        } catch (e) {
          console.error("Failed to parse history", e);
        }
      }
      setIsHistoryLoading(false);
    })();
  }, []);

  // Load persistence search mode and custom projects
  useEffect(() => {
    (async () => {
      const storedMode = await LocalStorage.getItem<string>("search-mode");
      if (
        storedMode === "quick" ||
        storedMode === "full" ||
        storedMode === "custom"
      ) {
        setSearchMode(storedMode as SearchMode);
      }
      const storedCustomProjects =
        await LocalStorage.getItem<string>("custom-projects");
      if (storedCustomProjects) {
        setCustomProjects(storedCustomProjects);
      }
    })();
  }, []);

  // Check Gcloud Status on mount
  useEffect(() => {
    (async () => {
      const status = await checkGcloudStatus();
      setGcloudStatus(status);
    })();
  }, []);

  // Handle Search Mode Change
  const handleModeChange = async (newValue: string) => {
    const mode = newValue as SearchMode;
    setSearchMode(mode);
    await LocalStorage.setItem("search-mode", mode);
  };

  // Add result to history
  const addToHistory = useCallback(
    async (ip: string, results: SearchResult[], mode: SearchMode) => {
      setHistory((prev) => {
        // Remove existing entry for this IP if any
        const filtered = prev.filter((h) => h.ip !== ip);
        const newItem: HistoryItem = {
          ip,
          results,
          timestamp: Date.now(),
          projectCount: new Set(results.map((r) => r.projectId)).size,
          mode,
        };
        const newHistory = [newItem, ...filtered].slice(0, 50); // Keep last 50
        LocalStorage.setItem("search-history", JSON.stringify(newHistory));
        return newHistory;
      });
    },
    [],
  );

  // Remove from history
  const removeFromHistory = useCallback(async (ip: string) => {
    setHistory((prev) => {
      const newHistory = prev.filter((h) => h.ip !== ip);
      LocalStorage.setItem("search-history", JSON.stringify(newHistory));
      return newHistory;
    });
  }, []);

  // Filter history
  const filteredHistory = useMemo(() => {
    return history.filter((h) => h.ip.includes(searchText));
  }, [history, searchText]);

  const startSearch = async (ip: string) => {
    if (!ip) return;

    // Check gcloud status before searching
    // status is handled in main view render
    if (gcloudStatus.type === "error") {
      return;
    }

    // Validate IP format
    if (!isValidIP(ip.trim())) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Invalid IP Address",
        message: "Please enter a valid IPv4 or IPv6 address",
      });
      return;
    }

    // Handle Custom Mode Config check
    if (searchMode === "custom" && !customProjects.trim()) {
      await showToast({
        style: Toast.Style.Failure,
        title: "No Custom Projects Configured",
        message: "Please add project IDs to search",
      });
      push(
        <CustomProjectsForm
          initialValue={customProjects}
          onSave={async (value) => {
            setCustomProjects(value);
            await LocalStorage.setItem("custom-projects", value);
          }}
        />,
      );
      return;
    }

    const customProjectList =
      searchMode === "custom"
        ? customProjects
            .split(",")
            .map((p) => p.trim())
            .filter((p) => p)
        : undefined;

    push(
      <ResultsView
        ip={ip}
        mode={searchMode}
        customProjectIds={customProjectList}
        onSaveToHistory={addToHistory}
        onSearchAgain={startSearch}
        onRemoveFromHistory={removeFromHistory}
      />,
    );
  };

  // Helper function to get error details for main view
  const getErrorDetails = () => {
    if (gcloudStatus.type !== "error") return null;

    switch (gcloudStatus.errorType) {
      case "missing_cli":
        return {
          title: "Gcloud CLI Not Found",
          description:
            "The Google Cloud SDK is required to use this extension.",
          command: "brew install google-cloud-sdk",
          commandLabel: "Install Command",
        };
      case "login_failed":
        return {
          title: "Authentication Required",
          description: "You are not logged in to Google Cloud.",
          command: "gcloud auth login",
          commandLabel: "Login Command",
        };
      default:
        return {
          title: "Connection Error",
          description:
            "An unexpected error occurred while connecting to Google Cloud.",
          command: "gcloud auth list",
          commandLabel: "Check Auth Command",
        };
    }
  };

  const errorDetails = getErrorDetails();

  // If there's an error, show error view instead of search interface
  if (gcloudStatus.type === "error" && errorDetails) {
    return (
      <List
        searchBarPlaceholder="Search IP or Select History..."
        navigationTitle="Search GCP IP Address | Status：🚫"
      >
        <List.EmptyView
          icon={{ source: Icon.ExclamationMark, tintColor: Color.Red }}
          title={errorDetails.title}
          description={`${errorDetails.description}\n\nHow to Fix: ${errorDetails.command}`}
          actions={
            <ActionPanel>
              <Action.CopyToClipboard
                title="Copy Command"
                content={errorDetails.command}
              />
              <Action.OpenInBrowser
                title="Open in GCP Console"
                url="https://console.cloud.google.com"
              />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  // Check if we should show welcome view
  const isInitialLoading = isHistoryLoading;
  const showWelcome = !searchText && history.length === 0 && !isInitialLoading;

  // Cycle search mode helper
  const nextMode = (current: SearchMode): SearchMode => {
    if (current === "quick") return "full";
    if (current === "full") return "custom";
    return "quick";
  };

  const getModeLabel = (mode: SearchMode) => {
    switch (mode) {
      case "quick":
        return "Quick (First Match)";
      case "full":
        return "Detailed (Full Scan)";
      case "custom":
        return "Custom (Selected Projects)";
      default:
        return mode;
    }
  };

  const cycleSearchMode = async () => {
    const next = nextMode(searchMode);
    await handleModeChange(next);
    await showToast({
      style: Toast.Style.Success,
      title: `Switched to ${getModeLabel(next)}`,
    });
  };

  return (
    <List
      isLoading={isInitialLoading}
      searchBarPlaceholder="Search IP or Select History..."
      onSearchTextChange={setSearchText}
      searchText={searchText}
      navigationTitle={
        gcloudStatus.type === "success"
          ? `Search GCP IP Address | ${gcloudStatus.account} | Status：✅`
          : gcloudStatus.type === "error"
            ? `Search GCP IP Address | Status：🚫 (${gcloudStatus.message})`
            : `Search GCP IP Address | Status：Checking...`
      }
      searchBarAccessory={
        <List.Dropdown
          tooltip="Search Mode"
          value={searchMode}
          onChange={handleModeChange}
        >
          <List.Dropdown.Item
            title="Quick (First Match)"
            value="quick"
            icon={Icon.Bolt}
          />
          <List.Dropdown.Item
            title="Detailed (Full Scan)"
            value="full"
            icon={Icon.MagnifyingGlass}
          />
          <List.Dropdown.Item
            title="Custom (Selected Projects)"
            value="custom"
            icon={Icon.List}
          />
        </List.Dropdown>
      }
    >
      {/* Show "Search New IP" if there is text input */}
      {searchText && (
        <List.Section title="New Search">
          <List.Item
            title={`Start Search "${searchText}"`}
            icon={Icon.MagnifyingGlass}
            actions={
              <ActionPanel>
                <Action
                  title="Start Search"
                  onAction={() => startSearch(searchText)}
                />
                <Action
                  title={`Switch Mode to ${nextMode(searchMode) === "quick" ? "Quick" : nextMode(searchMode) === "full" ? "Detailed" : "Custom"}`}
                  icon={Icon.ArrowRight}
                  shortcut={{ modifiers: ["cmd"], key: "m" }}
                  onAction={cycleSearchMode}
                />
                {searchMode === "custom" && (
                  <Action
                    title="Configure Custom Projects"
                    icon={Icon.Gear}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
                    onAction={() =>
                      push(
                        <CustomProjectsForm
                          initialValue={customProjects}
                          onSave={async (value) => {
                            setCustomProjects(value);
                            await LocalStorage.setItem(
                              "custom-projects",
                              value,
                            );
                            await showToast({
                              style: Toast.Style.Success,
                              title: "Configuration Saved",
                            });
                          }}
                        />,
                      )
                    }
                  />
                )}
              </ActionPanel>
            }
          />
        </List.Section>
      )}

      {!showWelcome && (
        <List.Section title="Recent Searches">
          {filteredHistory.map((item) => {
            const projectInfos = Array.from(
              new Set(
                item.results.map(
                  (r) => `${r.projectName || r.projectId} (${r.projectId})`,
                ),
              ),
            ).join(", ");

            return (
              <List.Item
                key={item.ip}
                title={item.ip}
                subtitle={`${item.results.length} ${
                  item.results.length === 1 ? "resource" : "resources"
                } found in ${projectInfos}`}
                accessories={[
                  item.mode === "custom"
                    ? { icon: Icon.List, tooltip: "Custom Scan" }
                    : item.mode === "full"
                      ? { icon: Icon.MagnifyingGlass, tooltip: "Full Scan" }
                      : { icon: Icon.Bolt, tooltip: "Quick Scan" },
                  { date: new Date(item.timestamp), tooltip: "Last searched" },
                ]}
                icon={Icon.Clock}
                actions={
                  <ActionPanel>
                    <Action
                      title="View Results"
                      icon={Icon.Eye}
                      onAction={() => {
                        // Check status before viewing
                        if (gcloudStatus.type === "error") {
                          return;
                        }
                        // Push with existing results to avoid re-searching
                        push(
                          <ResultsView
                            ip={item.ip}
                            initialResults={item.results}
                            onSaveToHistory={addToHistory}
                            onSearchAgain={startSearch}
                            onRemoveFromHistory={removeFromHistory}
                            mode={item.mode || "quick"}
                          />,
                        );
                      }}
                    />
                    <Action
                      title="Search Again"
                      icon={Icon.ArrowClockwise}
                      onAction={() => startSearch(item.ip)}
                    />
                    <Action
                      title="Remove from History"
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      onAction={() => removeFromHistory(item.ip)}
                      shortcut={{ modifiers: ["cmd"], key: "x" }}
                    />
                    <Action
                      title={`Switch Mode to ${nextMode(searchMode) === "quick" ? "Quick" : nextMode(searchMode) === "full" ? "Detailed" : "Custom"}`}
                      icon={Icon.ArrowRight}
                      shortcut={{ modifiers: ["cmd"], key: "m" }}
                      onAction={cycleSearchMode}
                    />
                    {searchMode === "custom" && (
                      <Action
                        title="Configure Custom Projects"
                        icon={Icon.Gear}
                        shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
                        onAction={() =>
                          push(
                            <CustomProjectsForm
                              initialValue={customProjects}
                              onSave={async (value) => {
                                setCustomProjects(value);
                                await LocalStorage.setItem(
                                  "custom-projects",
                                  value,
                                );
                                await showToast({
                                  style: Toast.Style.Success,
                                  title: "Configuration Saved",
                                });
                              }}
                            />,
                          )
                        }
                      />
                    )}
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      )}

      {showWelcome && (
        <List.EmptyView
          icon={{ source: Icon.MagnifyingGlass, tintColor: Color.Blue }}
          title="Welcome to GCP IP Search"
          description={`Search for IP addresses across all your Google Cloud projects.\n\n💡 Tip: You can switch between Quick, Detailed, and Custom search mode.`}
          actions={
            <ActionPanel>
              {searchMode === "custom" ? (
                <>
                  <Action
                    title="Configure Custom Projects"
                    icon={Icon.Gear}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
                    onAction={() =>
                      push(
                        <CustomProjectsForm
                          initialValue={customProjects}
                          onSave={async (value) => {
                            setCustomProjects(value);
                            await LocalStorage.setItem(
                              "custom-projects",
                              value,
                            );
                            await showToast({
                              style: Toast.Style.Success,
                              title: "Configuration Saved",
                            });
                          }}
                        />,
                      )
                    }
                  />
                  <Action
                    title={`Switch Mode to ${nextMode(searchMode) === "quick" ? "Quick" : nextMode(searchMode) === "full" ? "Detailed" : "Custom"}`}
                    icon={Icon.ArrowRight}
                    shortcut={{ modifiers: ["cmd"], key: "m" }}
                    onAction={cycleSearchMode}
                  />
                </>
              ) : (
                <>
                  <Action
                    title="Type Ip to Search…"
                    icon={Icon.MagnifyingGlass}
                    onAction={() => {}}
                  />
                  <Action
                    title={`Switch Mode to ${nextMode(searchMode) === "quick" ? "Quick" : nextMode(searchMode) === "full" ? "Detailed" : "Custom"}`}
                    icon={Icon.ArrowRight}
                    shortcut={{ modifiers: ["cmd"], key: "m" }}
                    onAction={cycleSearchMode}
                  />
                </>
              )}
            </ActionPanel>
          }
        />
      )}
    </List>
  );
}

function CustomProjectsForm({
  initialValue,
  onSave,
}: {
  initialValue: string;
  onSave: (value: string) => Promise<void>;
}) {
  const { pop } = useNavigation();
  const [value, setValue] = useState(initialValue);

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Projects"
            onSubmit={async () => {
              await onSave(value);
              await showToast({
                style: Toast.Style.Success,
                title: "Configuration Saved",
              });
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title="Custom Project List"
        text="Enter GCP Project IDs separated by commas. Only these projects will be searched in Custom mode."
      />
      <Form.TextArea
        id="projects"
        title="Project IDs"
        placeholder="project-id-1, project-id-2, project-id-3"
        value={value}
        onChange={setValue}
      />
    </Form>
  );
}

export default function Command() {
  return <SearchCommand />;
}

interface ResultsViewProps {
  ip: string;
  mode: SearchMode;
  customProjectIds?: string[];
  initialResults?: SearchResult[];
  onSaveToHistory: (
    ip: string,
    results: SearchResult[],
    mode: SearchMode,
  ) => Promise<void>;
  onSearchAgain: (ip: string) => Promise<void>;
  onRemoveFromHistory: (ip: string) => Promise<void>;
}

function ResultsView({
  ip,
  mode,
  customProjectIds,
  initialResults,
  onSaveToHistory,
  onSearchAgain,
  onRemoveFromHistory,
}: ResultsViewProps) {
  const [results, setResults] = useState<SearchResult[]>(initialResults || []);
  const [isLoading, setIsLoading] = useState(!initialResults);
  const [scanProgress, setScanProgress] = useState({
    current: 0,
    total: 0,
    currentProjectName: "",
    currentProjectId: "",
  });
  const [isShowingDetail, setIsShowingDetail] = useState(false);
  const [resultFilterText, setResultFilterText] = useState("");

  // Execute search if no initial results provided
  useEffect(() => {
    if (initialResults) return;

    let isMounted = true;

    (async () => {
      try {
        // Check gcloud
        const gcloudInstalled = await checkGcloudInstalled();
        if (!gcloudInstalled) {
          await showToast({
            style: Toast.Style.Failure,
            title: "Gcloud CLI Not Found",
            message: "The Google Cloud SDK is required to use this extension.",
          });
          if (isMounted) setIsLoading(false);
          return;
        }

        let projects = await getGCPProjects();

        // Filter projects for custom mode
        if (mode === "custom" && customProjectIds) {
          const allowedIds = new Set(customProjectIds);
          projects = projects.filter((p) => allowedIds.has(p.id));
        }

        if (isMounted) {
          setScanProgress({
            current: 0,
            total: projects.length,
            currentProjectName: "",
            currentProjectId: "",
          });
        }

        if (projects.length === 0) {
          if (isMounted) setIsLoading(false);

          // Only remove if it's NOT custom mode, because custom mode might return empty if user configured wrong IDs
          // But actually, getGCPProjects returns ALL projects user has access to.
          // If we filtered and got 0, it means user has no access to the configured projects OR configured them wrong.
          if (mode !== "custom") {
            // Remove from history as the context (account) has changed and no projects are accessible
            await onRemoveFromHistory(ip);
          }

          await showToast({
            style: Toast.Style.Failure,
            title: "No Accessible Projects Found",
            message:
              mode === "custom"
                ? "Check your custom project list"
                : "Check your gcloud auth",
          });
          return;
        }

        let processedCount = 0;
        const searchResults: SearchResult[] = [];
        const CONCURRENCY = 10;

        for (let i = 0; i < projects.length; i += CONCURRENCY) {
          if (!isMounted) break;

          // Check if we should stop early (Quick Mode)
          // Only stop if we found something AND we are in quick mode
          // Custom mode acts like Full mode (scans all selected projects)
          if (mode === "quick" && searchResults.length > 0) {
            break;
          }

          const batch = projects.slice(i, i + CONCURRENCY);

          const batchResults = await Promise.all(
            batch.map(async (project) => {
              try {
                return await searchIPInProject(project.id, project.name, ip);
              } catch {
                return [];
              } finally {
                processedCount++;
                if (isMounted) {
                  setScanProgress((prev) => ({
                    ...prev,
                    current: processedCount,
                    // Update project info when a request finishes to show activity
                    currentProjectName: project.name,
                    currentProjectId: project.id,
                  }));
                }
              }
            }),
          );

          const newResults = batchResults.flat();
          if (newResults.length > 0) {
            searchResults.push(...newResults);
          }
        }

        if (!isMounted) return;

        setScanProgress((prev) => ({ ...prev, current: projects.length }));
        setResults(searchResults);

        if (searchResults.length > 0) {
          await onSaveToHistory(ip, searchResults, mode);
        } else {
          // If no results found, remove from history
          await onRemoveFromHistory(ip);

          await showToast({
            style: Toast.Style.Failure,
            title: "No Resources Found",
            message: `IP ${ip} was not found. Removed from history.`,
          });
        }
      } catch (error) {
        if (!isMounted) return;
        await showToast({
          style: Toast.Style.Failure,
          title: "Search Failed",
          message: String(error),
        });
      } finally {
        if (isMounted) setIsLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [ip, mode]); // Run when IP or mode changes

  // Filter results based on search text
  const filteredResults = !resultFilterText
    ? results
    : results.filter((result) => {
        const lowerFilter = resultFilterText.toLowerCase();
        return (
          result.name.toLowerCase().includes(lowerFilter) ||
          result.projectId.toLowerCase().includes(lowerFilter) ||
          result.status?.toLowerCase().includes(lowerFilter) ||
          result.region?.toLowerCase().includes(lowerFilter) ||
          result.zone?.toLowerCase().includes(lowerFilter) ||
          result.ipAddress.includes(lowerFilter) ||
          result.addressType?.toLowerCase().includes(lowerFilter)
        );
      });

  const getModeLabel = () => {
    switch (mode) {
      case "quick":
        return "Quick Scan";
      case "full":
        return "Full Scan";
      case "custom":
        return "Custom Scan";
      default:
        return "";
    }
  };

  return (
    <List
      isLoading={false}
      searchBarPlaceholder={isLoading ? "Scanning..." : "Filter results..."}
      navigationTitle={`Results for ${ip} (${getModeLabel()})`}
      isShowingDetail={isShowingDetail}
      onSearchTextChange={setResultFilterText}
      searchText={resultFilterText}
      actions={
        // Global actions when not selecting a specific item
        !results.length && !isLoading ? (
          <ActionPanel>{/* Add global actions if needed */}</ActionPanel>
        ) : undefined
      }
    >
      {isLoading ? (
        <List.EmptyView
          icon={{ source: Icon.MagnifyingGlass, tintColor: Color.Blue }}
          title={
            scanProgress.total > 0
              ? `Scanning Projects (${scanProgress.current}/${scanProgress.total})`
              : "Initializing..."
          }
          description={
            scanProgress.currentProjectName && scanProgress.currentProjectId
              ? `Current: ${scanProgress.currentProjectName} (${scanProgress.currentProjectId})`
              : scanProgress.currentProjectName
                ? `Current: ${scanProgress.currentProjectName}`
                : "Starting search..."
          }
        />
      ) : filteredResults.length > 0 ? (
        <>
          <List.Section
            title={`Found ${filteredResults.length} ${filteredResults.length === 1 ? "resource" : "resources"} (${getModeLabel()})`}
          >
            {filteredResults.map((result, index) => {
              const resourceURL = generateResourceURL(result);
              const icon = getResourceIcon(result.resourceType);
              const resourceTypeName = getResourceTypeName(result.resourceType);
              const displayName = result.name;

              // Helper to get localized status and color
              const getStatusInfo = () => {
                let text = result.status || "-";
                let color = Color.SecondaryText;

                if (result.resourceType === "addresses") {
                  const statusRaw = result.status?.toUpperCase();
                  const typeStr = result.isStatic ? "Static" : "Ephemeral";

                  let statusStr = result.status || "";
                  if (statusRaw === "IN_USE") statusStr = "In Use";
                  else if (statusRaw === "RESERVED") statusStr = "Reserved";

                  text = statusRaw ? `${statusStr} (${typeStr})` : typeStr;

                  if (statusRaw === "RESERVED" || result.isStatic) {
                    color = Color.Green;
                  } else if (statusRaw === "IN_USE") {
                    color = Color.Orange;
                  }
                } else if (result.resourceType === "instances") {
                  const statusRaw = result.status?.toUpperCase();
                  if (statusRaw === "RUNNING") {
                    text = "Running";
                    color = Color.Green;
                  } else if (statusRaw === "TERMINATED") {
                    text = "Stopped";
                    color = Color.SecondaryText;
                  } else if (statusRaw) {
                    text = statusRaw;
                    color = Color.Orange;
                  }
                } else if (result.status) {
                  const statusRaw = result.status.toUpperCase();
                  if (statusRaw === "ACTIVE" || statusRaw === "READY")
                    color = Color.Green;
                }

                return { text, color };
              };

              const statusInfo = getStatusInfo();

              return (
                <List.Item
                  key={`${result.projectId}-${result.name}-${index}`}
                  icon={icon}
                  title={displayName}
                  accessories={
                    !isShowingDetail
                      ? [
                          { text: result.projectId, tooltip: "Project ID" },
                          {
                            text: result.region || result.zone || "Global",
                            tooltip: "Region/Zone",
                          },
                          ...(result.resourceType !== "forwarding-rules"
                            ? [
                                {
                                  tag: {
                                    value: statusInfo.text,
                                    color: statusInfo.color,
                                  },
                                },
                              ]
                            : []),
                        ]
                      : undefined
                  }
                  actions={
                    <ActionPanel>
                      <Action.OpenInBrowser
                        url={resourceURL}
                        title="Open in GCP Console"
                      />
                      <Action.CopyToClipboard
                        content={resourceURL}
                        title="Copy Link"
                      />
                      <Action
                        title={
                          isShowingDetail ? "Hide Details" : "Show Details"
                        }
                        icon={Icon.Sidebar}
                        shortcut={{ modifiers: ["cmd"], key: "d" }}
                        onAction={() => setIsShowingDetail((prev) => !prev)}
                      />

                      {/* Search Actions for Instance IPs */}
                      {result.resourceType === "instances" && (
                        <>
                          {result.internalIP && result.internalIP !== ip && (
                            <Action
                              title={`Start Search ${result.internalIP}`}
                              icon={Icon.MagnifyingGlass}
                              onAction={() => onSearchAgain(result.internalIP!)}
                            />
                          )}
                          {result.externalIP && result.externalIP !== ip && (
                            <Action
                              title={`Start Search ${result.externalIP}`}
                              icon={Icon.MagnifyingGlass}
                              onAction={() => onSearchAgain(result.externalIP!)}
                            />
                          )}
                        </>
                      )}
                    </ActionPanel>
                  }
                  detail={
                    <List.Item.Detail
                      metadata={
                        <List.Item.Detail.Metadata>
                          <List.Item.Detail.Metadata.Label
                            title="Resource Name"
                            text={result.name}
                          />
                          <List.Item.Detail.Metadata.Label
                            title="Project ID"
                            text={result.projectId}
                          />
                          <List.Item.Detail.Metadata.TagList title="Resource Type">
                            <List.Item.Detail.Metadata.TagList.Item
                              text={resourceTypeName}
                              color={Color.Blue}
                            />
                          </List.Item.Detail.Metadata.TagList>

                          <List.Item.Detail.Metadata.Separator />

                          {result.resourceType === "instances" ? (
                            <>
                              {result.internalIP && (
                                <List.Item.Detail.Metadata.Label
                                  title="Internal IP"
                                  text={result.internalIP}
                                />
                              )}
                              {result.externalIP && (
                                <List.Item.Detail.Metadata.Label
                                  title="External IP"
                                  text={result.externalIP}
                                />
                              )}
                            </>
                          ) : (
                            <List.Item.Detail.Metadata.Label
                              title="IP Address"
                              text={result.ipAddress}
                            />
                          )}

                          <List.Item.Detail.Metadata.Label
                            title="IP Version"
                            text={
                              result.ipVersion ||
                              (result.ipAddress.includes(":") ? "IPV6" : "IPV4")
                            }
                          />
                          {result.addressType && (
                            <List.Item.Detail.Metadata.TagList title="Address Type">
                              <List.Item.Detail.Metadata.TagList.Item
                                text={
                                  result.addressType === "INTERNAL"
                                    ? "Internal"
                                    : result.addressType === "EXTERNAL"
                                      ? "External"
                                      : result.addressType
                                }
                                color={
                                  result.addressType === "EXTERNAL"
                                    ? Color.Green
                                    : Color.Yellow
                                }
                              />
                            </List.Item.Detail.Metadata.TagList>
                          )}

                          <List.Item.Detail.Metadata.Separator />

                          {result.region && (
                            <List.Item.Detail.Metadata.Label
                              title="Region"
                              text={result.region}
                            />
                          )}
                          {result.subnetwork && (
                            <List.Item.Detail.Metadata.Label
                              title="Subnetwork"
                              text={result.subnetwork}
                            />
                          )}
                          {result.networkTier && (
                            <List.Item.Detail.Metadata.Label
                              title="Network Tier"
                              text={
                                result.networkTier === "PREMIUM"
                                  ? "Premium"
                                  : result.networkTier === "STANDARD"
                                    ? "Standard"
                                    : result.networkTier
                              }
                            />
                          )}

                          {result.status &&
                            result.resourceType !== "forwarding-rules" && (
                              <List.Item.Detail.Metadata.TagList title="Status">
                                <List.Item.Detail.Metadata.TagList.Item
                                  text={statusInfo.text}
                                  color={statusInfo.color}
                                />
                              </List.Item.Detail.Metadata.TagList>
                            )}

                          {result.users && result.users.length > 0 && (
                            <>
                              <List.Item.Detail.Metadata.Separator />
                              <List.Item.Detail.Metadata.Label title="Used By" />
                              {result.users.map((user) => (
                                <List.Item.Detail.Metadata.Label
                                  key={user}
                                  title=""
                                  text={user.split("/").pop()}
                                />
                              ))}
                            </>
                          )}
                        </List.Item.Detail.Metadata>
                      }
                    />
                  }
                />
              );
            })}
          </List.Section>
        </>
      ) : (
        <List.EmptyView
          icon={{ source: Icon.XMarkCircle, tintColor: Color.Red }}
          title="No Resources Found"
          description={`IP ${ip} was not found in any of your GCP projects.`}
          actions={
            !isLoading && mode === "quick" ? (
              <ActionPanel>
                <Action
                  title="Try Detailed Search"
                  icon={Icon.MagnifyingGlass}
                  onAction={() => {
                    // We need a way to temporarily switch mode or just start a search knowing it's full?
                    // For simplicity in this iteration, just letting user toggle dropdown.
                  }}
                />
              </ActionPanel>
            ) : undefined
          }
        />
      )}
    </List>
  );
}
