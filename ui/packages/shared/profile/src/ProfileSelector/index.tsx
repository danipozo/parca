// Copyright 2022 The Parca Authors
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import React, {Dispatch, SetStateAction, useEffect, useMemo, useRef, useState} from 'react';

import {Switch} from '@headlessui/react';
import {RpcError} from '@protobuf-ts/runtime-rpc';
import cx from 'classnames';
import Select, {type SelectInstance} from 'react-select';

import {Label, ProfileTypesResponse, QueryServiceClient} from '@parca/client';
import {
  Button,
  ButtonGroup,
  DateTimeRange,
  DateTimeRangePicker,
  IconButton,
  useGrpcMetadata,
  useParcaContext,
  useURLState,
} from '@parca/components';
import {CloseIcon} from '@parca/icons';
import {Query} from '@parca/parser';
import {type NavigateFunction} from '@parca/utilities';

import {MergedProfileSelection, ProfileSelection} from '..';
import MatchersInput, {useLabelNames} from '../MatchersInput/index';
import {useMetricsGraphDimensions} from '../MetricsGraph/useMetricsGraphDimensions';
import ProfileMetricsGraph, {ProfileMetricsEmptyState} from '../ProfileMetricsGraph';
import ProfileTypeSelector from '../ProfileTypeSelector/index';
import SimpleMatchers from '../SimpleMatchers';
import ViewMatchers from '../ViewMatchers';
import {useDefaultSumBy, useSumBySelection} from '../useSumBy';
import {useAutoQuerySelector} from './useAutoQuerySelector';

export interface QuerySelection {
  expression: string;
  from: number;
  to: number;
  timeSelection: string;
  sumBy?: string[];
  mergeFrom?: number;
  mergeTo?: number;
}

interface ProfileSelectorProps {
  queryClient: QueryServiceClient;
  querySelection: QuerySelection;
  selectProfile: (source: ProfileSelection) => void;
  selectQuery: (query: QuerySelection) => void;
  closeProfile: () => void;
  enforcedProfileName: string;
  profileSelection: ProfileSelection | null;
  comparing: boolean;
  navigateTo: NavigateFunction;
  suffix?: string;
  showMetricsGraph: boolean;
  setDisplayHideMetricsGraphButton: Dispatch<SetStateAction<boolean>>;
}

export interface IProfileTypesResult {
  loading: boolean;
  data?: ProfileTypesResponse;
  error?: RpcError;
}

export const useProfileTypes = (client: QueryServiceClient): IProfileTypesResult => {
  const [result, setResult] = useState<ProfileTypesResponse | undefined>(undefined);
  const [error, setError] = useState<RpcError | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const metadata = useGrpcMetadata();

  useEffect(() => {
    if (!loading) {
      return;
    }
    const call = client.profileTypes({}, {meta: metadata});
    call.response
      .then(response => setResult(response))
      .catch(error => setError(error))
      .finally(() => setLoading(false));
  }, [client, metadata, loading]);

  return {loading, data: result, error};
};

const ProfileSelector = ({
  queryClient,
  querySelection,
  selectProfile,
  selectQuery,
  closeProfile,
  enforcedProfileName,
  profileSelection,
  comparing,
  navigateTo,
  showMetricsGraph,
  setDisplayHideMetricsGraphButton,
}: ProfileSelectorProps): JSX.Element => {
  const {
    loading: profileTypesLoading,
    data: profileTypesData,
    error,
  } = useProfileTypes(queryClient);
  const {heightStyle} = useMetricsGraphDimensions(comparing);
  const {viewComponent} = useParcaContext();
  const sumByRef = useRef(null);
  const [queryBrowserMode, setQueryBrowserMode] = useURLState('query_browser_mode');

  const [timeRangeSelection, setTimeRangeSelection] = useState(
    DateTimeRange.fromRangeKey(querySelection.timeSelection, querySelection.from, querySelection.to)
  );

  const [queryExpressionString, setQueryExpressionString] = useState(querySelection.expression);

  const [advancedModeForQueryBrowser, setAdvancedModeForQueryBrowser] = useState(
    queryBrowserMode === 'advanced'
  );

  const profileType = useMemo(() => {
    return Query.parse(queryExpressionString).profileType();
  }, [queryExpressionString]);

  const selectedProfileType = useMemo(() => {
    return Query.parse(querySelection.expression).profileType();
  }, [querySelection.expression]);

  const {loading: labelNamesLoading, result} = useLabelNames(queryClient, profileType.toString());
  const {loading: selectedLabelNamesLoading, result: selectedLabelNamesResult} = useLabelNames(
    queryClient,
    selectedProfileType.toString()
  );

  const labels = useMemo(() => {
    return result.response?.labelNames === undefined ? [] : result.response.labelNames;
  }, [result]);

  const selectedLabels = useMemo(() => {
    return selectedLabelNamesResult.response?.labelNames === undefined
      ? []
      : selectedLabelNamesResult.response.labelNames;
  }, [selectedLabelNamesResult]);

  const [sumBySelection, setUserSumBySelection, {isLoading: sumBySelectionLoading}] =
    useSumBySelection(profileType, labelNamesLoading, labels, {
      defaultValue: querySelection.sumBy,
    });

  const {defaultSumBy, isLoading: defaultSumByLoading} = useDefaultSumBy(
    selectedProfileType,
    selectedLabelNamesLoading,
    selectedLabels
  );

  useEffect(() => {
    if (enforcedProfileName !== '') {
      const [q, changed] = Query.parse(querySelection.expression).setProfileName(
        enforcedProfileName
      );
      if (changed) {
        setQueryExpressionString(q.toString());
        return;
      }
    }
    setQueryExpressionString(querySelection.expression);
  }, [enforcedProfileName, querySelection.expression]);

  const enforcedProfileNameQuery = (): Query => {
    const pq = Query.parse(queryExpressionString);
    const [q] = pq.setProfileName(enforcedProfileName);
    return q;
  };

  const query =
    enforcedProfileName !== '' ? enforcedProfileNameQuery() : Query.parse(queryExpressionString);
  const selectedProfileName = query.profileName();

  const setNewQueryExpression = (expr: string, updateTs = false): void => {
    const query = enforcedProfileName !== '' ? enforcedProfileNameQuery() : Query.parse(expr);
    const delta = query.profileType().delta;
    const from = timeRangeSelection.getFromMs(updateTs);
    const to = timeRangeSelection.getToMs(updateTs);
    const mergeParams = delta
      ? {
          mergeFrom: from,
          mergeTo: to,
        }
      : {};

    selectQuery({
      expression: expr,
      from,
      to,
      timeSelection: timeRangeSelection.getRangeKey(),
      sumBy: sumBySelection,
      ...mergeParams,
    });
  };

  const setQueryExpression = (updateTs = false): void => {
    setNewQueryExpression(query.toString(), updateTs);
  };

  const addLabelMatcher = (
    labels: {key: string; value: string} | Array<{key: string; value: string}>
  ): void => {
    // When a user clicks on a label on the metrics graph tooltip,
    // replace single `\` in the `value` string with doubles `\\` if available.
    const replaceBackslash = (value: string): string => {
      return value.includes('\\') ? value.replaceAll('\\', '\\\\') : value;
    };

    let newQuery: Query;
    let hasChanged: boolean;

    if (Array.isArray(labels)) {
      const newLabels = labels.map(({key, value}) => {
        const newValue = replaceBackslash(value);
        return {key, value: newValue};
      });
      const [query, changed] = Query.parse(queryExpressionString).setMultipleMatchers(newLabels);
      hasChanged = changed;
      newQuery = query;
    } else {
      const {key, value} = labels;
      const newValue = replaceBackslash(value);
      const [query, changed] = Query.parse(queryExpressionString).setMatcher(key, newValue);
      hasChanged = changed;
      newQuery = query;
    }

    if (hasChanged) {
      // TODO: Change this to store the query object
      setNewQueryExpression(newQuery.toString());
    }
  };

  const setMatchersString = (matchers: string): void => {
    const newExpressionString = `${selectedProfileName}{${matchers}}`;
    setQueryExpressionString(newExpressionString);
  };

  const setProfileName = (profileName: string | undefined): void => {
    if (profileName === undefined) {
      return;
    }
    const [newQuery, changed] = query.setProfileName(profileName);
    if (changed) {
      const q = newQuery.toString();
      setQueryExpressionString(q);
    }
  };

  useEffect(() => {
    if (viewComponent !== undefined) {
      viewComponent.emitQuery(query.toString());
    }
  }, [query, viewComponent]);

  useAutoQuerySelector({
    selectedProfileName,
    profileTypesData,
    setProfileName,
    setQueryExpression,
    querySelection: {...querySelection, sumBy: sumBySelection},
    navigateTo,
    loading: sumBySelectionLoading,
  });

  const searchDisabled =
    queryExpressionString === undefined ||
    queryExpressionString === '' ||
    queryExpressionString === '{}';

  const queryBrowserRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <div className="mb-2 flex">
        <div className="flex w-full flex-wrap items-end gap-2">
          <div>
            <label className="text-xs">Profile type</label>
            <ProfileTypeSelector
              profileTypesData={profileTypesData}
              loading={profileTypesLoading}
              selectedKey={selectedProfileName}
              onSelection={setProfileName}
              error={error}
              disabled={viewComponent?.disableProfileTypesDropdown}
            />
          </div>
          <div className="w-full flex-1 flex flex-col gap-1" ref={queryBrowserRef}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <label className="text-xs">Query</label>
                {viewComponent?.disableExplorativeQuerying === true ? null : (
                  <>
                    <Switch
                      checked={advancedModeForQueryBrowser}
                      onChange={() => {
                        setAdvancedModeForQueryBrowser(!advancedModeForQueryBrowser);
                        setQueryBrowserMode(advancedModeForQueryBrowser ? 'simple' : 'advanced');
                      }}
                      className={`${
                        advancedModeForQueryBrowser
                          ? 'bg-indigo-600'
                          : 'bg-gray-400 dark:bg-gray-800'
                      }
          relative inline-flex h-[20px] w-[44px] shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2  focus-visible:ring-white/75`}
                    >
                      <span className="sr-only">Use setting</span>
                      <span
                        aria-hidden="true"
                        className={`${
                          advancedModeForQueryBrowser ? 'translate-x-6' : 'translate-x-0'
                        }
            pointer-events-none inline-block h-[16px] w-[16px] transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out`}
                      />
                    </Switch>
                    <label className="text-xs">Advanced Mode</label>
                  </>
                )}
              </div>
              {(query.matchers.length > 0 || query.inputMatcherString.length > 0) &&
                viewComponent !== undefined && <div>{viewComponent?.createViewComponent}</div>}
            </div>
            {viewComponent?.disableExplorativeQuerying === true &&
            viewComponent?.labelnames !== undefined &&
            viewComponent?.labelnames.length >= 1 ? (
              <>
                <ViewMatchers
                  labelNames={viewComponent.labelnames}
                  setMatchersString={setMatchersString}
                  profileType={selectedProfileName}
                  runQuery={setQueryExpression}
                  currentQuery={query}
                  queryClient={queryClient}
                />
              </>
            ) : (
              <>
                {advancedModeForQueryBrowser ? (
                  <MatchersInput
                    queryClient={queryClient}
                    setMatchersString={setMatchersString}
                    runQuery={setQueryExpression}
                    currentQuery={query}
                    profileType={selectedProfileName}
                  />
                ) : (
                  <SimpleMatchers
                    queryClient={queryClient}
                    setMatchersString={setMatchersString}
                    runQuery={setQueryExpression}
                    currentQuery={query}
                    profileType={selectedProfileName}
                    queryBrowserRef={queryBrowserRef}
                  />
                )}
              </>
            )}
          </div>
          <div>
            <div className="mb-0.5 mt-1.5 flex items-center justify-between">
              <label className="text-xs">Sum by</label>
            </div>
            <Select
              id="h-sum-by-selector"
              defaultValue={[]}
              isMulti
              name="colors"
              options={labels.map(label => ({label, value: label}))}
              className="parca-select-container text-sm w-full max-w-80"
              classNamePrefix="parca-select"
              value={(sumBySelection ?? []).map(sumBy => ({label: sumBy, value: sumBy}))}
              onChange={selectedOptions => {
                setUserSumBySelection(selectedOptions.map(option => option.value));
              }}
              placeholder="Labels..."
              styles={{
                indicatorSeparator: () => ({display: 'none'}),
                menu: provided => ({...provided, width: 'max-content'}),
              }}
              isDisabled={!profileType.delta}
              ref={sumByRef}
              onKeyDown={e => {
                const currentRef = sumByRef.current as unknown as SelectInstance | null;
                if (currentRef == null) {
                  return;
                }
                const inputRef = currentRef.inputRef;
                if (inputRef == null) {
                  return;
                }

                if (
                  e.key === 'Enter' &&
                  inputRef.value === '' &&
                  currentRef.state.focusedOptionId === null // menu is not open
                ) {
                  setQueryExpression(true);
                  currentRef.blur();
                }
              }}
            />
          </div>
          <DateTimeRangePicker
            onRangeSelection={setTimeRangeSelection}
            range={timeRangeSelection}
          />
          <ButtonGroup>
            <Button
              disabled={searchDisabled}
              onClick={(e: React.MouseEvent<HTMLElement>) => {
                e.preventDefault();
                setQueryExpression(true);
              }}
              id="h-matcher-search-button"
            >
              Search
            </Button>
          </ButtonGroup>
        </div>
        <div>{comparing && <IconButton onClick={() => closeProfile()} icon={<CloseIcon />} />}</div>
      </div>
      <div
        className={cx('relative', {
          'py-4': !showMetricsGraph,
        })}
      >
        <button
          onClick={() => setDisplayHideMetricsGraphButton(!showMetricsGraph)}
          className={cx(
            'hidden z-10 px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:bg-gray-900',
            showMetricsGraph && 'absolute right-0 bottom-3 !flex',
            !showMetricsGraph && 'relative !flex ml-auto'
          )}
        >
          {showMetricsGraph ? 'Hide' : 'Show'} Metrics Graph
        </button>
        {showMetricsGraph ? (
          <div style={{height: heightStyle}}>
            {querySelection.expression !== undefined &&
            querySelection.expression.length > 0 &&
            querySelection.from !== undefined &&
            querySelection.to !== undefined ? (
              <div>
                <ProfileMetricsGraph
                  queryClient={queryClient}
                  queryExpression={querySelection.expression}
                  from={querySelection.from}
                  to={querySelection.to}
                  profile={profileSelection}
                  comparing={comparing}
                  sumBy={querySelection.sumBy ?? defaultSumBy ?? []}
                  sumByLoading={defaultSumByLoading}
                  setTimeRange={(range: DateTimeRange) => {
                    const from = range.getFromMs();
                    const to = range.getToMs();
                    let mergedProfileParams = {};
                    if (query.profileType().delta) {
                      mergedProfileParams = {mergeFrom: from, mergeTo: to};
                    }
                    setTimeRangeSelection(range);
                    selectQuery({
                      expression: queryExpressionString,
                      from,
                      to,
                      timeSelection: range.getRangeKey(),
                      ...mergedProfileParams,
                    });
                  }}
                  addLabelMatcher={addLabelMatcher}
                  onPointClick={(
                    timestamp: number,
                    labels: Label[],
                    queryExpression: string,
                    duration: number
                  ) => {
                    // TODO: Pass the query object via click rather than queryExpression
                    let query = Query.parse(queryExpression);
                    labels.forEach(l => {
                      const [newQuery, updated] = query.setMatcher(l.name, l.value);
                      if (updated) {
                        query = newQuery;
                      }
                    });

                    const durationInMilliseconds = duration / 1000000; // duration is in nanoseconds
                    const mergeFrom = timestamp;
                    const mergeTo = query.profileType().delta
                      ? mergeFrom + durationInMilliseconds
                      : mergeFrom;
                    selectProfile(new MergedProfileSelection(mergeFrom, mergeTo, query));
                  }}
                />
              </div>
            ) : (
              <>
                {profileSelection == null ? (
                  <div className="p-2">
                    <ProfileMetricsEmptyState
                      message={`Please select a profile type and click "Search" to begin.`}
                    />
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
};

export default ProfileSelector;
