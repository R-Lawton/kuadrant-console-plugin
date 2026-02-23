import * as React from 'react';
import { useTranslation } from 'react-i18next';
import {
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
} from '@patternfly/react-core';
import {
  usePrometheusPoll,
  PrometheusEndpoint,
} from '@openshift-console/dynamic-plugin-sdk';
import { useParams } from 'react-router-dom';
import '../kuadrant.css';

interface PrometheusData {
  data?: {
    result?: Array<{
      metric: Record<string, string>;
      values: [number, string][];
    }>;
  };
}

interface RouteParams {
  ns?: string;
  name?: string;
}

// Simple SVG line chart
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

  const colors = ['#06c', '#8a3ffc', '#33b679', '#d73027', '#ff9800'];

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

// Stat Panel
const StatPanel: React.FC<{
  value: number;
  label: string;
  unit?: string;
  thresholds?: { value: number; color: string }[];
}> = ({ value, label, unit = '', thresholds = [] }) => {
  let color = 'var(--pf-v6-global--primary-color--100)';

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

const MetricsPanel: React.FC<{
  query: string;
  description?: string;
  visualizationType?: 'line' | 'stat';
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
      <div
        style={{
          height: '300px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
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
      result.metric.route ||
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

const RateLimitPolicyObservabilityTab: React.FC = () => {
  const { t } = useTranslation('plugin__kuadrant-console-plugin');
  const { ns, name } = useParams<RouteParams>();

  return (
    <div style={{ padding: '1rem 0' }}>
      <Alert
        variant={AlertVariant.info}
        isInline
        title={t('Rate Limit Metrics')}
        style={{ marginBottom: '1rem' }}
      >
        <p>
          Live metrics for RateLimitPolicy <strong>{name}</strong> in namespace{' '}
          <strong>{ns}</strong>. Metrics show rate limiting activity and policy effectiveness.
        </p>
      </Alert>

      <Grid hasGutter>
        <GridItem lg={4}>
          <Card>
            <CardTitle>
              <Title headingLevel="h3">Total Requests</Title>
            </CardTitle>
            <CardBody>
              <MetricsPanel
                query={`sum(rate(envoy_ratelimit_service_rate_limit_envoy_service_RateLimitService_ShouldRateLimit{ratelimit_policy_name="${name}",ratelimit_policy_namespace="${ns}"}[5m]))`}
                description="Total rate limit check requests per second"
                visualizationType="stat"
              />
            </CardBody>
          </Card>
        </GridItem>

        <GridItem lg={4}>
          <Card>
            <CardTitle>
              <Title headingLevel="h3">Limited Requests</Title>
            </CardTitle>
            <CardBody>
              <MetricsPanel
                query={`sum(rate(envoy_ratelimit_service_rate_limit_over_limit{ratelimit_policy_name="${name}",ratelimit_policy_namespace="${ns}"}[5m]))`}
                description="Requests blocked by rate limits per second"
                visualizationType="stat"
              />
            </CardBody>
          </Card>
        </GridItem>

        <GridItem lg={4}>
          <Card>
            <CardTitle>
              <Title headingLevel="h3">Within Limit</Title>
            </CardTitle>
            <CardBody>
              <MetricsPanel
                query={`sum(rate(envoy_ratelimit_service_rate_limit_ok{ratelimit_policy_name="${name}",ratelimit_policy_namespace="${ns}"}[5m]))`}
                description="Requests allowed through per second"
                visualizationType="stat"
              />
            </CardBody>
          </Card>
        </GridItem>

        <GridItem lg={12}>
          <Card>
            <CardTitle>
              <Title headingLevel="h2">Rate Limit Decisions Over Time</Title>
            </CardTitle>
            <CardBody>
              <MetricsPanel
                query={`sum(rate(envoy_ratelimit_service_rate_limit_envoy_service_RateLimitService_ShouldRateLimit{ratelimit_policy_name="${name}",ratelimit_policy_namespace="${ns}"}[5m])) by (response_code)`}
                description="Rate limit service responses: OK (allowed), OVER_LIMIT (blocked)"
                visualizationType="line"
              />
            </CardBody>
          </Card>
        </GridItem>

        <GridItem lg={12}>
          <Card>
            <CardTitle>
              <Title headingLevel="h2">Request Rate by Route</Title>
            </CardTitle>
            <CardBody>
              <MetricsPanel
                query={`sum(rate(istio_requests_total{ratelimit_policy_name="${name}",ratelimit_policy_namespace="${ns}"}[5m])) by (route)`}
                description="Incoming request rate per HTTPRoute affected by this policy"
                visualizationType="line"
              />
            </CardBody>
          </Card>
        </GridItem>

        <GridItem>
          <Card>
            <CardTitle>
              <Title headingLevel="h2">About Rate Limit Metrics</Title>
            </CardTitle>
            <CardBody>
              <Content component={ContentVariants.p}>
                <strong>Metrics shown:</strong>
              </Content>
              <ul style={{ paddingLeft: '1.5rem', marginTop: '0.5rem' }}>
                <li>
                  <strong>Total Requests:</strong> All rate limit check requests (green if low, red
                  if high)
                </li>
                <li>
                  <strong>Limited Requests:</strong> Requests that exceeded limits and were blocked
                </li>
                <li>
                  <strong>Within Limit:</strong> Requests that passed rate limit checks
                </li>
                <li>
                  <strong>Decisions Over Time:</strong> Time-series showing OK vs OVER_LIMIT
                  responses
                </li>
                <li>
                  <strong>Request Rate by Route:</strong> Which HTTPRoutes are generating traffic
                </li>
              </ul>

              <Content component={ContentVariants.p} style={{ marginTop: '1rem' }}>
                <strong>Note:</strong> These metrics require Envoy rate limit service and proper
                metric exporters. If you see "No data available", verify:
              </Content>
              <ul style={{ paddingLeft: '1.5rem', marginTop: '0.5rem' }}>
                <li>Limitador or Envoy rate limit service is running</li>
                <li>Prometheus is scraping rate limit service metrics</li>
                <li>Policy is attached to an HTTPRoute or Gateway with traffic</li>
                <li>
                  Metric labels include <code>ratelimit_policy_name</code> and{' '}
                  <code>ratelimit_policy_namespace</code>
                </li>
              </ul>
            </CardBody>
          </Card>
        </GridItem>
      </Grid>
    </div>
  );
};

export default RateLimitPolicyObservabilityTab;
