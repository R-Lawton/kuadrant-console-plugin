import * as React from 'react';
import Helmet from 'react-helmet';
import { useTranslation } from 'react-i18next';
import {
  PageSection,
  Title,
  Card,
  CardTitle,
  CardBody,
  Grid,
  GridItem,
  Content,
  ContentVariants,
  Alert,
  AlertVariant,
  Spinner,
  EmptyState,
  EmptyStateBody,
  Tabs,
  Tab,
  TabTitleText,
} from '@patternfly/react-core';
import {
  usePrometheusPoll,
  PrometheusEndpoint,
} from '@openshift-console/dynamic-plugin-sdk';
import './kuadrant.css';

interface PrometheusData {
  data?: {
    result?: Array<{
      metric: Record<string, string>;
      values: [number, string][];
    }>;
  };
}

// Simple SVG line chart component
const LineChart: React.FC<{
  data: Array<{ name: string; values: [number, string][] }>;
  width?: number;
  height?: number;
}> = ({ data, width = 600, height = 250 }) => {
  if (data.length === 0) return null;

  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const allValues = data.flatMap((series) => series.values);
  const minTime = Math.min(...allValues.map(([t]) => t));
  const maxTime = Math.max(...allValues.map(([t]) => t));
  const minValue = Math.min(...allValues.map(([, v]) => parseFloat(v)));
  const maxValue = Math.max(...allValues.map(([, v]) => parseFloat(v)));

  const yPadding = (maxValue - minValue) * 0.1;
  const yMin = Math.max(0, minValue - yPadding);
  const yMax = maxValue + yPadding;

  const xScale = (timestamp: number) =>
    ((timestamp - minTime) / (maxTime - minTime)) * chartWidth;
  const yScale = (value: number) =>
    chartHeight - ((value - yMin) / (yMax - yMin)) * chartHeight;

  const colors = ['#06c', '#8a3ffc', '#33b679', '#d73027', '#ff9800', '#00acc1', '#e91e63'];

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const xTicks = Array.from({ length: 5 }, (_, i) => {
    const timestamp = minTime + ((maxTime - minTime) * i) / 4;
    return { timestamp, x: xScale(timestamp) };
  });

  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const value = yMin + ((yMax - yMin) * i) / 4;
    return { value, y: yScale(value) };
  });

  return (
    <svg width={width} height={height} style={{ fontFamily: 'monospace', fontSize: '11px' }}>
      <g transform={`translate(${padding.left},${padding.top})`}>
        {yTicks.map(({ y }, i) => (
          <line
            key={i}
            x1={0}
            y1={y}
            x2={chartWidth}
            y2={y}
            stroke="var(--pf-v6-global--BorderColor--100)"
            strokeWidth={1}
            strokeDasharray="2,2"
          />
        ))}
        <line
          x1={0}
          y1={0}
          x2={0}
          y2={chartHeight}
          stroke="var(--pf-v6-global--BorderColor--200)"
          strokeWidth={1}
        />
        {yTicks.map(({ value, y }, i) => (
          <text
            key={i}
            x={-10}
            y={y}
            textAnchor="end"
            alignmentBaseline="middle"
            fill="var(--pf-v6-global--Color--200)"
          >
            {value.toFixed(2)}
          </text>
        ))}
        <line
          x1={0}
          y1={chartHeight}
          x2={chartWidth}
          y2={chartHeight}
          stroke="var(--pf-v6-global--BorderColor--200)"
          strokeWidth={1}
        />
        {xTicks.map(({ timestamp, x }, i) => (
          <text
            key={i}
            x={x}
            y={chartHeight + 20}
            textAnchor="middle"
            fill="var(--pf-v6-global--Color--200)"
          >
            {formatTime(timestamp)}
          </text>
        ))}
        {data.map((series, seriesIdx) => {
          const points = series.values
            .map(([timestamp, value]) => {
              const x = xScale(timestamp);
              const y = yScale(parseFloat(value));
              return `${x},${y}`;
            })
            .join(' ');

          return (
            <g key={seriesIdx}>
              <polyline
                points={points}
                fill="none"
                stroke={colors[seriesIdx % colors.length]}
                strokeWidth={2}
              />
              {series.values.map(([timestamp, value], i) => (
                <circle
                  key={i}
                  cx={xScale(timestamp)}
                  cy={yScale(parseFloat(value))}
                  r={3}
                  fill={colors[seriesIdx % colors.length]}
                />
              ))}
            </g>
          );
        })}
        <g transform={`translate(0, ${chartHeight + 35})`}>
          {data.map((series, i) => (
            <g key={i} transform={`translate(${i * 150}, 0)`}>
              <rect x={0} y={-8} width={12} height={12} fill={colors[i % colors.length]} />
              <text
                x={18}
                y={0}
                alignmentBaseline="middle"
                fill="var(--pf-v6-global--Color--100)"
                style={{ fontSize: '12px' }}
              >
                {series.name}
              </text>
            </g>
          ))}
        </g>
      </g>
    </svg>
  );
};

// Area Chart (stacked)
const AreaChart: React.FC<{
  data: Array<{ name: string; values: [number, string][] }>;
  width?: number;
  height?: number;
}> = ({ data, width = 600, height = 250 }) => {
  if (data.length === 0) return null;

  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const allValues = data.flatMap((series) => series.values);
  const minTime = Math.min(...allValues.map(([t]) => t));
  const maxTime = Math.max(...allValues.map(([t]) => t));
  const maxValue = Math.max(...allValues.map(([, v]) => parseFloat(v)));

  const xScale = (timestamp: number) =>
    ((timestamp - minTime) / (maxTime - minTime)) * chartWidth;
  const yScale = (value: number) => chartHeight - (value / (maxValue * 1.1)) * chartHeight;

  const colors = ['#06c', '#8a3ffc', '#33b679', '#d73027'];

  return (
    <svg width={width} height={height} style={{ fontFamily: 'monospace', fontSize: '11px' }}>
      <g transform={`translate(${padding.left},${padding.top})`}>
        {data.map((series, seriesIdx) => {
          const points = series.values
            .map(([timestamp, value]) => `${xScale(timestamp)},${yScale(parseFloat(value))}`)
            .join(' ');
          const closedPath =
            `M0,${chartHeight} ` +
            points +
            ` L${chartWidth},${chartHeight} Z`;

          return (
            <path
              key={seriesIdx}
              d={closedPath}
              fill={colors[seriesIdx % colors.length]}
              fillOpacity={0.5}
              stroke={colors[seriesIdx % colors.length]}
              strokeWidth={2}
            />
          );
        })}
      </g>
    </svg>
  );
};

// Bar Chart
const BarChart: React.FC<{
  data: Array<{ name: string; value: number }>;
  width?: number;
  height?: number;
}> = ({ data, width = 600, height = 250 }) => {
  if (data.length === 0) return null;

  const padding = { top: 20, right: 20, bottom: 60, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const maxValue = Math.max(...data.map((d) => d.value));
  const barWidth = chartWidth / data.length - 10;

  const colors = ['#06c', '#8a3ffc', '#33b679', '#d73027', '#ff9800', '#00acc1'];

  return (
    <svg width={width} height={height} style={{ fontFamily: 'monospace', fontSize: '11px' }}>
      <g transform={`translate(${padding.left},${padding.top})`}>
        {data.map((item, i) => {
          const barHeight = (item.value / (maxValue * 1.1)) * chartHeight;
          const x = (i * chartWidth) / data.length + 5;
          const y = chartHeight - barHeight;

          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                fill={colors[i % colors.length]}
                opacity={0.8}
              />
              <text
                x={x + barWidth / 2}
                y={chartHeight + 15}
                textAnchor="middle"
                fill="var(--pf-v6-global--Color--200)"
                style={{ fontSize: '10px' }}
              >
                {item.name}
              </text>
              <text
                x={x + barWidth / 2}
                y={y - 5}
                textAnchor="middle"
                fill="var(--pf-v6-global--Color--100)"
                fontWeight="bold"
              >
                {item.value.toFixed(2)}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
};

// Gauge/Stat Panel
const StatPanel: React.FC<{
  value: number;
  label: string;
  unit?: string;
  thresholds?: { value: number; color: string }[];
}> = ({ value, label, unit = '', thresholds = [] }) => {
  let color = 'var(--pf-v6-global--primary-color--100)';

  // Find threshold color
  for (const threshold of thresholds.sort((a, b) => b.value - a.value)) {
    if (value >= threshold.value) {
      color = threshold.color;
      break;
    }
  }

  return (
    <div
      style={{
        padding: '2rem',
        textAlign: 'center',
        backgroundColor: 'var(--pf-v6-global--BackgroundColor--200)',
        borderRadius: '8px',
        border: '1px solid var(--pf-v6-global--BorderColor--100)',
      }}
    >
      <div style={{ fontSize: '3rem', fontWeight: 'bold', color, marginBottom: '0.5rem' }}>
        {value.toFixed(2)}
        <span style={{ fontSize: '1.5rem', marginLeft: '0.25rem' }}>{unit}</span>
      </div>
      <div style={{ fontSize: '1rem', color: 'var(--pf-v6-global--Color--200)' }}>{label}</div>
    </div>
  );
};

// Heatmap visualization (simplified)
const HeatmapChart: React.FC<{
  data: Array<{ name: string; values: [number, string][] }>;
  width?: number;
  height?: number;
}> = ({ data, width = 600, height = 200 }) => {
  if (data.length === 0) return null;

  const padding = { top: 20, right: 20, bottom: 40, left: 100 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const cellWidth = chartWidth / (data[0]?.values.length || 1);
  const cellHeight = chartHeight / data.length;

  const allValues = data.flatMap((s) => s.values.map(([, v]) => parseFloat(v)));
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);

  const getColor = (value: number) => {
    const normalized = (value - minVal) / (maxVal - minVal);
    const r = Math.floor(normalized * 255);
    const b = Math.floor((1 - normalized) * 255);
    return `rgb(${r}, 100, ${b})`;
  };

  return (
    <svg width={width} height={height} style={{ fontFamily: 'monospace', fontSize: '11px' }}>
      <g transform={`translate(${padding.left},${padding.top})`}>
        {data.map((series, rowIdx) => (
          <g key={rowIdx}>
            <text
              x={-10}
              y={rowIdx * cellHeight + cellHeight / 2}
              textAnchor="end"
              alignmentBaseline="middle"
              fill="var(--pf-v6-global--Color--200)"
            >
              {series.name}
            </text>
            {series.values.map(([, value], colIdx) => (
              <rect
                key={colIdx}
                x={colIdx * cellWidth}
                y={rowIdx * cellHeight}
                width={cellWidth - 1}
                height={cellHeight - 1}
                fill={getColor(parseFloat(value))}
                opacity={0.8}
              />
            ))}
          </g>
        ))}
      </g>
    </svg>
  );
};

// Table Panel
const TablePanel: React.FC<{
  data: Array<{ name: string; values: [number, string][] }>;
}> = ({ data }) => {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '0.875rem',
        }}
      >
        <thead>
          <tr style={{ backgroundColor: 'var(--pf-v6-global--BackgroundColor--200)' }}>
            <th
              style={{
                padding: '0.75rem',
                textAlign: 'left',
                borderBottom: '2px solid var(--pf-v6-global--BorderColor--100)',
              }}
            >
              Series
            </th>
            <th
              style={{
                padding: '0.75rem',
                textAlign: 'right',
                borderBottom: '2px solid var(--pf-v6-global--BorderColor--100)',
              }}
            >
              Current
            </th>
            <th
              style={{
                padding: '0.75rem',
                textAlign: 'right',
                borderBottom: '2px solid var(--pf-v6-global--BorderColor--100)',
              }}
            >
              Min
            </th>
            <th
              style={{
                padding: '0.75rem',
                textAlign: 'right',
                borderBottom: '2px solid var(--pf-v6-global--BorderColor--100)',
              }}
            >
              Max
            </th>
            <th
              style={{
                padding: '0.75rem',
                textAlign: 'right',
                borderBottom: '2px solid var(--pf-v6-global--BorderColor--100)',
              }}
            >
              Avg
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((series, idx) => {
            const values = series.values.map(([, v]) => parseFloat(v));
            const current = values[values.length - 1];
            const min = Math.min(...values);
            const max = Math.max(...values);
            const avg = values.reduce((a, b) => a + b, 0) / values.length;

            return (
              <tr
                key={idx}
                style={{
                  backgroundColor:
                    idx % 2 === 0 ? 'transparent' : 'var(--pf-v6-global--BackgroundColor--200)',
                }}
              >
                <td style={{ padding: '0.75rem', fontWeight: 500 }}>{series.name}</td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>{current.toFixed(2)}</td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>{min.toFixed(2)}</td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>{max.toFixed(2)}</td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>{avg.toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// Main metrics panel with different visualization types
const MetricsPanel: React.FC<{
  query: string;
  description?: string;
  visualizationType?: 'line' | 'area' | 'bar' | 'stat' | 'heatmap' | 'table';
}> = ({ query, description, visualizationType = 'line' }) => {
  const [data, loaded, error] = usePrometheusPoll({
    endpoint: PrometheusEndpoint.QUERY_RANGE,
    query,
    timespan: 3600000,
  }) as [PrometheusData, boolean, any];

  if (error) {
    return (
      <div style={{ padding: '1rem' }}>
        <Alert variant={AlertVariant.danger} isInline title="Error loading metrics">
          {error.message || 'Failed to fetch Prometheus data'}
        </Alert>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  const results = data?.data?.result || [];

  if (results.length === 0) {
    return (
      <div style={{ padding: '1rem' }}>
        <EmptyState>
          <EmptyStateBody>
            <div style={{ textAlign: 'center' }}>
              <div style={{ marginBottom: '0.5rem' }}>No data available</div>
              <div style={{ fontSize: '0.875rem', color: 'var(--pf-v6-global--Color--200)' }}>
                Query: <code style={{ fontSize: '0.75rem' }}>{query}</code>
              </div>
            </div>
          </EmptyStateBody>
        </EmptyState>
      </div>
    );
  }

  const chartData = results.map((result, idx) => {
    const seriesName =
      result.metric.source_workload ||
      result.metric.response_code ||
      Object.entries(result.metric)
        .filter(([k]) => k !== '__name__')
        .map(([k, v]) => `${k}=${v}`)
        .join(', ') ||
      `Series ${idx + 1}`;

    return {
      name: seriesName,
      values: result.values,
    };
  });

  // For bar chart, get latest values
  const barData = chartData.map((series) => ({
    name: series.name,
    value: parseFloat(series.values[series.values.length - 1][1]),
  }));

  // For stat panel, use first series
  const statValue = chartData[0]
    ? parseFloat(chartData[0].values[chartData[0].values.length - 1][1])
    : 0;

  return (
    <div style={{ padding: '1rem' }}>
      {description && (
        <Content
          component={ContentVariants.small}
          style={{ marginBottom: '1rem', color: 'var(--pf-v6-global--Color--200)' }}
        >
          {description}
        </Content>
      )}

      <div style={{ overflowX: 'auto' }}>
        {visualizationType === 'line' && <LineChart data={chartData} width={600} height={300} />}
        {visualizationType === 'area' && <AreaChart data={chartData} width={600} height={300} />}
        {visualizationType === 'bar' && <BarChart data={barData} width={600} height={300} />}
        {visualizationType === 'stat' && (
          <StatPanel
            value={statValue}
            label={chartData[0]?.name || 'Value'}
            thresholds={[
              { value: 100, color: '#c9190b' },
              { value: 50, color: '#f0ab00' },
              { value: 0, color: '#3e8635' },
            ]}
          />
        )}
        {visualizationType === 'heatmap' && (
          <HeatmapChart data={chartData} width={600} height={200} />
        )}
        {visualizationType === 'table' && <TablePanel data={chartData} />}
      </div>

      <div
        style={{
          fontSize: '0.75rem',
          color: 'var(--pf-v6-global--Color--200)',
          marginTop: '0.75rem',
        }}
      >
        Query: <code style={{ fontSize: '0.7rem' }}>{query}</code>
      </div>
    </div>
  );
};

const KuadrantObservabilityPage: React.FC = () => {
  const { t } = useTranslation('plugin__kuadrant-console-plugin');
  const [activeTabKey, setActiveTabKey] = React.useState<string | number>(0);

  return (
    <>
      <Helmet>
        <title>{t('Kuadrant Observability')}</title>
      </Helmet>
      <PageSection className="kuadrant-overview-page">
        <Title headingLevel="h1" className="pf-u-mb-lg">
          {t('Kuadrant Observability')}
        </Title>

        <Content component={ContentVariants.p} className="pf-u-mb-md">
          {t(
            'Live Gateway API metrics powered by Prometheus. Different visualization types demonstrate what Perses can do.',
          )}
        </Content>

        <Alert
          variant={AlertVariant.info}
          isInline
          title={t('Perses Panel Types POC')}
          className="pf-u-mb-md"
        >
          <p>
            This page demonstrates different visualization types that Perses supports. Each tab shows
            the same metrics visualized in different ways:
          </p>
          <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem' }}>
            <li>
              <strong>Line Chart:</strong> Time-series data with multiple series
            </li>
            <li>
              <strong>Area Chart:</strong> Filled/stacked time-series visualization
            </li>
            <li>
              <strong>Bar Chart:</strong> Latest values comparison across series
            </li>
            <li>
              <strong>Stat/Gauge:</strong> Single value with threshold coloring
            </li>
            <li>
              <strong>Heatmap:</strong> Density visualization across time and series
            </li>
            <li>
              <strong>Table:</strong> Detailed statistics (current, min, max, avg)
            </li>
          </ul>
        </Alert>

        <Tabs activeKey={activeTabKey} onSelect={(_, tabKey) => setActiveTabKey(tabKey)}>
          <Tab eventKey={0} title={<TabTitleText>Line Charts</TabTitleText>}>
            <div style={{ padding: '1rem 0' }}>
              <Grid hasGutter>
                <GridItem lg={12}>
                  <Card>
                    <CardTitle>
                      <Title headingLevel="h2">Gateway Request Rate (Line Chart)</Title>
                    </CardTitle>
                    <CardBody>
                      <MetricsPanel
                        query='sum(rate(istio_requests_total{reporter="source"}[5m])) by (source_workload)'
                        description="Time-series line chart showing requests per second"
                        visualizationType="line"
                      />
                    </CardBody>
                  </Card>
                </GridItem>
              </Grid>
            </div>
          </Tab>

          <Tab eventKey={1} title={<TabTitleText>Area Charts</TabTitleText>}>
            <div style={{ padding: '1rem 0' }}>
              <Grid hasGutter>
                <GridItem lg={12}>
                  <Card>
                    <CardTitle>
                      <Title headingLevel="h2">HTTPRoute Requests by Code (Area Chart)</Title>
                    </CardTitle>
                    <CardBody>
                      <MetricsPanel
                        query='sum(rate(istio_requests_total{reporter="source"}[5m])) by (response_code)'
                        description="Stacked area chart showing request distribution"
                        visualizationType="area"
                      />
                    </CardBody>
                  </Card>
                </GridItem>
              </Grid>
            </div>
          </Tab>

          <Tab eventKey={2} title={<TabTitleText>Bar Charts</TabTitleText>}>
            <div style={{ padding: '1rem 0' }}>
              <Grid hasGutter>
                <GridItem lg={12}>
                  <Card>
                    <CardTitle>
                      <Title headingLevel="h2">Current Request Rate by Gateway (Bar Chart)</Title>
                    </CardTitle>
                    <CardBody>
                      <MetricsPanel
                        query='sum(rate(istio_requests_total{reporter="source"}[5m])) by (source_workload)'
                        description="Latest values shown as bars for easy comparison"
                        visualizationType="bar"
                      />
                    </CardBody>
                  </Card>
                </GridItem>
              </Grid>
            </div>
          </Tab>

          <Tab eventKey={3} title={<TabTitleText>Stat Panels</TabTitleText>}>
            <div style={{ padding: '1rem 0' }}>
              <Grid hasGutter>
                <GridItem lg={4}>
                  <Card>
                    <CardTitle>
                      <Title headingLevel="h3">Total Request Rate</Title>
                    </CardTitle>
                    <CardBody>
                      <MetricsPanel
                        query='sum(rate(istio_requests_total{reporter="source"}[5m]))'
                        description="Single stat with threshold colors (green < 50 < yellow < 100 < red)"
                        visualizationType="stat"
                      />
                    </CardBody>
                  </Card>
                </GridItem>
                <GridItem lg={4}>
                  <Card>
                    <CardTitle>
                      <Title headingLevel="h3">Error Rate</Title>
                    </CardTitle>
                    <CardBody>
                      <MetricsPanel
                        query='sum(rate(istio_requests_total{reporter="source",response_code=~"5.."}[5m]))'
                        description="Big number display with color-coded thresholds"
                        visualizationType="stat"
                      />
                    </CardBody>
                  </Card>
                </GridItem>
                <GridItem lg={4}>
                  <Card>
                    <CardTitle>
                      <Title headingLevel="h3">P95 Latency</Title>
                    </CardTitle>
                    <CardBody>
                      <MetricsPanel
                        query='histogram_quantile(0.95, sum(rate(istio_request_duration_milliseconds_bucket{reporter="source"}[5m])) by (le))'
                        description="Gauge-style visualization perfect for dashboards"
                        visualizationType="stat"
                      />
                    </CardBody>
                  </Card>
                </GridItem>
              </Grid>
            </div>
          </Tab>

          <Tab eventKey={4} title={<TabTitleText>Heatmaps</TabTitleText>}>
            <div style={{ padding: '1rem 0' }}>
              <Grid hasGutter>
                <GridItem lg={12}>
                  <Card>
                    <CardTitle>
                      <Title headingLevel="h2">Response Codes Over Time (Heatmap)</Title>
                    </CardTitle>
                    <CardBody>
                      <MetricsPanel
                        query='sum(rate(istio_requests_total{reporter="source"}[5m])) by (response_code)'
                        description="Color intensity shows value magnitude across time and series"
                        visualizationType="heatmap"
                      />
                    </CardBody>
                  </Card>
                </GridItem>
              </Grid>
            </div>
          </Tab>

          <Tab eventKey={5} title={<TabTitleText>Tables</TabTitleText>}>
            <div style={{ padding: '1rem 0' }}>
              <Grid hasGutter>
                <GridItem lg={12}>
                  <Card>
                    <CardTitle>
                      <Title headingLevel="h2">Gateway Metrics Summary (Table)</Title>
                    </CardTitle>
                    <CardBody>
                      <MetricsPanel
                        query='sum(rate(istio_requests_total{reporter="source"}[5m])) by (source_workload)'
                        description="Detailed statistics table with current, min, max, and average values"
                        visualizationType="table"
                      />
                    </CardBody>
                  </Card>
                </GridItem>
              </Grid>
            </div>
          </Tab>
        </Tabs>

        <Grid hasGutter style={{ marginTop: '2rem' }}>
          <GridItem>
            <Card>
              <CardTitle>
                <Title headingLevel="h2">About Perses Panel Types</Title>
              </CardTitle>
              <CardBody>
                <Content component={ContentVariants.p}>
                  <strong>Perses supports many visualization types:</strong>
                </Content>
                <Grid hasGutter style={{ marginTop: '1rem' }}>
                  <GridItem md={6}>
                    <ul style={{ paddingLeft: '1.5rem' }}>
                      <li>
                        <strong>Time Series Charts:</strong> Line, Area, Stacked Area with zoom/pan
                      </li>
                      <li>
                        <strong>Bar Charts:</strong> Vertical, Horizontal, Grouped, Stacked
                      </li>
                      <li>
                        <strong>Stat Panels:</strong> Big numbers with sparklines, thresholds, gauges
                      </li>
                      <li>
                        <strong>Gauges:</strong> Progress bars, circular gauges with thresholds
                      </li>
                    </ul>
                  </GridItem>
                  <GridItem md={6}>
                    <ul style={{ paddingLeft: '1.5rem' }}>
                      <li>
                        <strong>Heatmaps:</strong> Density visualization over time
                      </li>
                      <li>
                        <strong>Tables:</strong> Sortable, filterable data grids
                      </li>
                      <li>
                        <strong>Markdown:</strong> Text panels with variables
                      </li>
                      <li>
                        <strong>Custom:</strong> Extensible plugin system
                      </li>
                    </ul>
                  </GridItem>
                </Grid>

                <Content component={ContentVariants.p} style={{ marginTop: '1.5rem' }}>
                  <strong>Perses Features:</strong>
                </Content>
                <ul style={{ paddingLeft: '1.5rem', marginTop: '0.5rem' }}>
                  <li>Interactive tooltips on hover with all series values</li>
                  <li>Click & drag to zoom, double-click to reset</li>
                  <li>Dashboard variables for dynamic filtering (e.g., namespace selector)</li>
                  <li>Panel linking - click a bar to filter other panels</li>
                  <li>Annotations and event markers</li>
                  <li>Alert thresholds with visual indicators</li>
                  <li>Time range picker with relative and absolute ranges</li>
                  <li>Export to PNG/CSV</li>
                </ul>

                <Content component={ContentVariants.p} style={{ marginTop: '1rem' }}>
                  <strong>References:</strong>
                </Content>
                <ul style={{ paddingLeft: '1.5rem', marginTop: '0.5rem' }}>
                  <li>
                    <a
                      href="https://perses.dev/perses/docs/embedding-panels/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Perses Embedding Panels Documentation
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://perses.dev/perses/docs/panels/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Perses Panel Types Reference
                    </a>
                  </li>
                </ul>
              </CardBody>
            </Card>
          </GridItem>
        </Grid>
      </PageSection>
    </>
  );
};

export default React.memo(KuadrantObservabilityPage);
