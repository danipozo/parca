// Copyright 2021 The Parca Authors
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

package storage

import (
	"errors"
	"fmt"
	"math"
	"sync"

	"github.com/parca-dev/parca/pkg/storage/chunkenc"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/prometheus/pkg/labels"
)

var (
	ErrOutOfOrderSample = errors.New("out of order sample")
)

type MemSeries struct {
	lset labels.Labels
	id   uint64

	periodType ValueType
	sampleType ValueType

	minTime, maxTime int64
	timestamps       timestampChunks
	durations        []chunkenc.Chunk
	periods          []chunkenc.Chunk

	// TODO: Might be worth combining behind some struct?
	// Or maybe not because it's easier to serialize?

	// mu locks the following maps for concurrent access.
	mu sync.RWMutex
	// Flat and cumulative values as well as labels by the node's ProfileTreeValueNodeKey.
	flatValues       map[ProfileTreeValueNodeKey][]chunkenc.Chunk
	cumulativeValues map[ProfileTreeValueNodeKey][]chunkenc.Chunk
	labels           map[ProfileTreeValueNodeKey]map[string][]string
	numLabels        map[ProfileTreeValueNodeKey]map[string][]int64
	numUnits         map[ProfileTreeValueNodeKey]map[string][]string

	seriesTree *MemSeriesTree
	numSamples uint16

	samplesAppended prometheus.Counter
}

func NewMemSeries(lset labels.Labels, id uint64) *MemSeries {
	s := &MemSeries{
		lset: lset,
		id:   id,
		timestamps: timestampChunks{{
			minTime: math.MaxInt64,
			maxTime: math.MinInt64,
			chunk:   chunkenc.NewDeltaChunk(),
		}},
		durations: []chunkenc.Chunk{chunkenc.NewRLEChunk()},
		periods:   []chunkenc.Chunk{chunkenc.NewRLEChunk()},

		flatValues:       make(map[ProfileTreeValueNodeKey][]chunkenc.Chunk),
		cumulativeValues: make(map[ProfileTreeValueNodeKey][]chunkenc.Chunk),
		labels:           make(map[ProfileTreeValueNodeKey]map[string][]string),
		numLabels:        make(map[ProfileTreeValueNodeKey]map[string][]int64),
		numUnits:         make(map[ProfileTreeValueNodeKey]map[string][]string),
	}
	s.seriesTree = &MemSeriesTree{s: s}

	return s
}

func (s *MemSeries) Labels() labels.Labels {
	return s.lset
}

func (s *MemSeries) Appender() (*MemSeriesAppender, error) {
	timestamps, err := s.timestamps[len(s.timestamps)-1].chunk.Appender()
	if err != nil {
		return nil, err
	}
	durations, err := s.durations[len(s.timestamps)-1].Appender()
	if err != nil {
		return nil, err
	}
	periods, err := s.periods[len(s.timestamps)-1].Appender()
	if err != nil {
		return nil, err
	}

	return &MemSeriesAppender{
		s:          s,
		timestamps: timestamps,
		duration:   durations,
		periods:    periods,
	}, nil
}

func (s *MemSeries) appendTree(profileTree *ProfileTree) error {
	if s.seriesTree == nil {
		s.seriesTree = &MemSeriesTree{s: s}
	}

	return s.seriesTree.Insert(s.numSamples%samplesPerChunk, profileTree)
}

type MemSeriesStats struct {
	samples     uint16
	Cumulatives []MemSeriesValueStats
	Flat        []MemSeriesValueStats
}

type MemSeriesValueStats struct {
	samples int
	bytes   int
}

func (s *MemSeries) stats() MemSeriesStats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	flat := make([]MemSeriesValueStats, 0, len(s.flatValues))
	cumulative := make([]MemSeriesValueStats, 0, len(s.cumulativeValues))

	for _, chunks := range s.flatValues {
		for _, c := range chunks {
			flat = append(flat, MemSeriesValueStats{
				samples: c.NumSamples(),
				bytes:   len(c.Bytes()),
			})
		}
	}

	for _, chunks := range s.cumulativeValues {
		for _, c := range chunks {
			cumulative = append(cumulative, MemSeriesValueStats{
				samples: c.NumSamples(),
				bytes:   len(c.Bytes()),
			})
		}
	}

	return MemSeriesStats{
		samples:     s.numSamples,
		Cumulatives: cumulative,
		Flat:        flat,
	}
}

type MemSeriesAppender struct {
	s          *MemSeries
	timestamps chunkenc.Appender
	duration   chunkenc.Appender
	periods    chunkenc.Appender
}

const samplesPerChunk = 120

func (a *MemSeriesAppender) Append(p *Profile) error {
	if a.s.numSamples == 0 {
		a.s.periodType = p.Meta.PeriodType
		a.s.sampleType = p.Meta.SampleType
	}

	if !equalValueType(a.s.periodType, p.Meta.PeriodType) {
		return ErrPeriodTypeMismatch
	}

	if !equalValueType(a.s.sampleType, p.Meta.SampleType) {
		return ErrSampleTypeMismatch
	}

	timestamp := p.Meta.Timestamp

	if timestamp <= a.s.maxTime {
		return ErrOutOfOrderSample
	}

	newChunks := false
	a.s.mu.Lock()
	if a.s.timestamps[len(a.s.timestamps)-1].chunk.NumSamples() >= samplesPerChunk {
		newChunks = true
	}
	a.s.mu.Unlock()

	if newChunks {
		a.s.mu.Lock()

		for k := range a.s.cumulativeValues {
			a.s.cumulativeValues[k] = append(a.s.cumulativeValues[k], chunkenc.NewXORChunk())
		}
		for k := range a.s.flatValues {
			a.s.flatValues[k] = append(a.s.flatValues[k], chunkenc.NewXORChunk())
		}

		a.s.timestamps = append(a.s.timestamps, timestampChunk{
			maxTime: timestamp,
			minTime: timestamp,
			chunk:   chunkenc.NewDeltaChunk(),
		})
		app, err := a.s.timestamps[len(a.s.timestamps)-1].chunk.Appender()
		if err != nil {
			a.s.mu.Unlock()
			return fmt.Errorf("failed to add the next timestamp chunk: %w", err)
		}
		a.timestamps = app

		a.s.durations = append(a.s.durations, chunkenc.NewRLEChunk())
		app, err = a.s.durations[len(a.s.durations)-1].Appender()
		if err != nil {
			a.s.mu.Unlock()
			return fmt.Errorf("failed to add the next durations chunk: %w", err)
		}
		a.duration = app

		a.s.periods = append(a.s.periods, chunkenc.NewRLEChunk())
		app, err = a.s.periods[len(a.s.periods)-1].Appender()
		if err != nil {
			a.s.mu.Unlock()
			return fmt.Errorf("failed to add the next periods chunk: %w", err)
		}
		a.periods = app
		a.s.mu.Unlock()
	}

	// appendTree locks the maps itself.
	if err := a.s.appendTree(p.Tree); err != nil {
		return err
	}

	a.timestamps.AppendAt(a.s.numSamples%samplesPerChunk, timestamp)
	a.duration.AppendAt(a.s.numSamples%samplesPerChunk, p.Meta.Duration)
	a.periods.AppendAt(a.s.numSamples%samplesPerChunk, p.Meta.Period)

	a.s.mu.Lock()
	if a.s.timestamps[len(a.s.timestamps)-1].minTime > timestamp {
		a.s.timestamps[len(a.s.timestamps)-1].minTime = timestamp
	}
	if a.s.timestamps[len(a.s.timestamps)-1].maxTime < timestamp {
		a.s.timestamps[len(a.s.timestamps)-1].maxTime = timestamp
	}
	a.s.mu.Unlock()

	// Set the timestamp as minTime if timestamp != 0
	if a.s.minTime == 0 && timestamp != 0 {
		a.s.minTime = timestamp
	}

	a.s.maxTime = timestamp
	a.s.numSamples++

	if a.s.samplesAppended != nil {
		a.s.samplesAppended.Inc()
	}
	return nil
}
