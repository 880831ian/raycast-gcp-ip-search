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

interface HistoryItem {
  ip: string;
  results: SearchResult[];
  timestamp: number;
  projectCount: number;
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

  // Check Gcloud Status on mount
  useEffect(() => {
    (async () => {
      const status = await checkGcloudStatus();
      setGcloudStatus(status);
    })();
  }, []);

  // Save history helper
  const saveHistory = useCallback(async (newHistory: HistoryItem[]) => {
    setHistory(newHistory);
    await LocalStorage.setItem("search-history", JSON.stringify(newHistory));
  }, []);

  // Add result to history
  const addToHistory = useCallback(
    async (ip: string, results: SearchResult[]) => {
      // Remove existing entry for this IP if any
      const filtered = history.filter((h) => h.ip !== ip);
      const newItem: HistoryItem = {
        ip,
        results,
        timestamp: Date.now(),
        projectCount: new Set(results.map((r) => r.projectId)).size,
      };
      const newHistory = [newItem, ...filtered].slice(0, 50); // Keep last 50
      await saveHistory(newHistory);
    },
    [history, saveHistory],
  );

  // Remove from history
  const removeFromHistory = useCallback(
    async (ip: string) => {
      const newHistory = history.filter((h) => h.ip !== ip);
      await saveHistory(newHistory);
    },
    [history, saveHistory],
  );

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

    push(
      <ResultsView
        ip={ip}
        onSaveToHistory={addToHistory}
        onSearchAgain={startSearch}
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

  return (
    <List
      isLoading={isInitialLoading}
      searchBarPlaceholder="Search IP or Select History..."
      onSearchTextChange={setSearchText}
      searchText={searchText}
      navigationTitle={
        gcloudStatus.type === "success"
          ? `Search GCP IP Address | Status：✅`
          : gcloudStatus.type === "error"
            ? `Search GCP IP Address | Status：🚫 (${gcloudStatus.message})`
            : `Search GCP IP Address | Status：Checking...`
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
              </ActionPanel>
            }
          />
        </List.Section>
      )}

      {!showWelcome && (
        <List.Section title="Recent Searches">
          {filteredHistory.map((item) => (
            <List.Item
              key={item.ip}
              title={item.ip}
              subtitle={`${item.results.length} ${item.results.length === 1 ? "resource" : "resources"} found in ${item.projectCount} projects`}
              accessories={[
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
                    shortcut={{ modifiers: ["ctrl"], key: "x" }}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}

      {showWelcome && (
        <List.EmptyView
          icon={{ source: Icon.MagnifyingGlass, tintColor: Color.Blue }}
          title="Welcome to GCP IP Search"
          description={`Search for IP addresses across all your Google Cloud projects.\n\n💡 Tip: Use the search bar above to start.`}
        />
      )}
    </List>
  );
}

export default function Command() {
  return <SearchCommand />;
}

interface ResultsViewProps {
  ip: string;
  initialResults?: SearchResult[];
  onSaveToHistory: (ip: string, results: SearchResult[]) => Promise<void>;
  onSearchAgain: (ip: string) => Promise<void>;
}

function ResultsView({
  ip,
  initialResults,
  onSaveToHistory,
  onSearchAgain,
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

        const projects = await getGCPProjects();
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
          await showToast({
            style: Toast.Style.Failure,
            title: "No GCP projects found",
            message: "Check your gcloud auth",
          });
          return;
        }

        let processedCount = 0;
        const searchResults: SearchResult[] = [];
        const CONCURRENCY = 10;

        for (let i = 0; i < projects.length; i += CONCURRENCY) {
          if (!isMounted) break;
          // If we already found results in previous batches, stop scanning
          if (searchResults.length > 0) break;

          const batch = projects.slice(i, i + CONCURRENCY);

          const batchResults = await Promise.all(
            batch.map(async (project) => {
              try {
                return await searchIPInProject(project.id, ip);
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
          await onSaveToHistory(ip, searchResults);
        } else {
          await showToast({
            style: Toast.Style.Failure,
            title: "No Resources Found",
            message: `IP ${ip} was not found in any of your GCP projects.`,
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
  }, [ip]); // Only run when IP changes

  // Filter results based on search text (calculate directly, not using useMemo inside condition)
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

  return (
    <List
      isLoading={false}
      searchBarPlaceholder={isLoading ? "Scanning..." : "Filter results..."}
      navigationTitle={`Results for ${ip}`}
      isShowingDetail={isShowingDetail}
      onSearchTextChange={setResultFilterText}
      searchText={resultFilterText}
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
            title={`Found ${filteredResults.length} ${filteredResults.length === 1 ? "resource" : "resources"}`}
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
                    // Fallback for other statuses like PROVISIONING, STAGING, SUSPENDED
                    text = statusRaw;
                    color = Color.Orange;
                  }
                } else if (result.status) {
                  // Default for other resources
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
                          // Show status tag unless it's a forwarding rule
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
                              shortcut={{ modifiers: ["opt"], key: "i" }}
                            />
                          )}
                          {result.externalIP && result.externalIP !== ip && (
                            <Action
                              title={`Start Search ${result.externalIP}`}
                              icon={Icon.MagnifyingGlass}
                              onAction={() => onSearchAgain(result.externalIP!)}
                              shortcut={{ modifiers: ["opt"], key: "e" }}
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

                          {/* IP Address - Show specifics for Instances, generic for others */}
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
                          {/* Address Type - Only show if present (don't default to INTERNAL) and localize */}
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
                          {/* Network Tier - Localize */}
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

                          {/* Status - Hide for forwarding rules */}
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
        />
      )}
    </List>
  );
}
