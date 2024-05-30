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

import React, {useMemo} from 'react';

import {Icon} from '@iconify/react';
import cx from 'classnames';

import {useURLState} from '@parca/components';
import {USER_PREFERENCES, useCurrentColorProfile, useUserPreference} from '@parca/hooks';
import {EVERYTHING_ELSE, selectDarkMode, useAppSelector} from '@parca/store';
import {getLastItem, type NavigateFunction} from '@parca/utilities';

import {getMappingColors} from '.';

interface Props {
  mappings?: string[];
  loading?: boolean;
  navigateTo?: NavigateFunction;
  compareMode?: boolean;
}

const ColorStackLegend = ({
  mappings,
  navigateTo,
  compareMode = false,
  loading,
}: Props): React.JSX.Element => {
  const isDarkMode = useAppSelector(selectDarkMode);
  const currentColorProfile = useCurrentColorProfile();
  const [colorProfileName] = useUserPreference<string>(
    USER_PREFERENCES.FLAMEGRAPH_COLOR_PROFILE.key
  );
  const [currentSearchString, setSearchString] = useURLState({
    param: 'binary_frame_filter',
    navigateTo,
  });

  const mappingsList = useMemo(() => {
    if (mappings === undefined) {
      return [];
    }
    const list =
      mappings
        ?.map(mapping => {
          return getLastItem(mapping) as string;
        })
        .flat() ?? [];

    // We add a EVERYTHING ELSE mapping to the list.
    list.push('');

    // We sort the mappings alphabetically to make sure that the order is always the same.
    list.sort((a, b) => a.localeCompare(b));

    return list;
  }, [mappings]);

  const mappingColors = useMemo(() => {
    const colors = getMappingColors(mappingsList, isDarkMode, currentColorProfile);
    return colors;
  }, [isDarkMode, mappingsList, currentColorProfile]);

  const stackColorArray = useMemo(() => {
    return Object.entries(mappingColors).sort(([featureA], [featureB]) => {
      if (featureA === EVERYTHING_ELSE) {
        return 1;
      }
      if (featureB === EVERYTHING_ELSE) {
        return -1;
      }
      return featureA?.localeCompare(featureB ?? '') ?? 0;
    });
  }, [mappingColors]);

  if (stackColorArray.length === 0 && loading === false) {
    return <></>;
  }

  if (Object.entries(mappingColors).length === 0) {
    return <></>;
  }

  if (colorProfileName === 'default' || compareMode) {
    return <></>;
  }

  return (
    <div className="my-4 flex w-full flex-wrap justify-start">
      {stackColorArray.map(([feature, color]) => {
        const filteringAllowed = feature !== EVERYTHING_ELSE;
        const isHighlighted =
          currentSearchString !== undefined ? currentSearchString.includes(feature) : false;
        return (
          <div
            key={feature}
            className={cx(
              'flex-no-wrap mb-1 flex w-1/5 items-center justify-between text-ellipsis p-1',
              {
                'cursor-pointer': filteringAllowed,
                'bg-gray-200 dark:bg-gray-800': isHighlighted,
              }
            )}
            onClick={() => {
              if (!filteringAllowed || isHighlighted) {
                return;
              }

              // Check if the current search string is defined and an array
              const updatedSearchString = Array.isArray(currentSearchString)
                ? [...currentSearchString, feature] // If array, append the feature
                : // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
                currentSearchString // If not array, preserve current value
                ? currentSearchString.split(',') // If string, split by commas
                : [feature]; // If undefined, initialize array with feature

              setSearchString(updatedSearchString);
            }}
          >
            <div className="flex w-11/12 items-center justify-start">
              <div className="flex w-5 items-center">
                <div className="mr-1 inline-block h-4 w-4" style={{backgroundColor: color}} />
              </div>
              <div className="shrink overflow-hidden text-ellipsis whitespace-nowrap text-sm hover:whitespace-normal">
                {feature}
              </div>
            </div>
            <div className="flex w-1/12 justify-end">
              {isHighlighted && (
                <Icon
                  icon="radix-icons:cross-circled"
                  onClick={e => {
                    let searchString: string[] = [];
                    if (typeof currentSearchString === 'string') {
                      searchString.push(currentSearchString);
                    } else {
                      searchString = currentSearchString;
                    }

                    // remove the current feature from the search string array of strings
                    setSearchString(searchString.filter((f: string) => f !== feature));
                    e.stopPropagation();
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ColorStackLegend;
